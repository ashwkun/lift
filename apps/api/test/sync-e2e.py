"""End-to-end sync test against a live API + Postgres."""
import json
import urllib.request
import urllib.error
import uuid
import time

API = "http://localhost:3999"
failures = []
passes = []


def call(path, payload=None, token=None, method="POST"):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body or b"{}")
        except Exception:
            return e.code, {"raw": body.decode()[:300]}


def check(name, condition, detail=""):
    (passes if condition else failures).append(name)
    print(f"{'PASS' if condition else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not condition else ""))


def signup(email):
    status, body = call("/api/auth/sign-up/email",
                        {"email": email, "password": "correct-horse-battery", "name": "Lifter"})
    return body.get("token")


# --------------------------------------------------------------------------
print("\n--- auth ---")
token_a = signup(f"a-{uuid.uuid4().hex[:8]}@example.com")
token_b = signup(f"b-{uuid.uuid4().hex[:8]}@example.com")
check("sign-up returns a session token", bool(token_a) and bool(token_b))

status, _ = call("/api/sync/pull", {"cursor": None, "limit": 100})
check("pull without a token is rejected", status == 401, f"got {status}")

# --------------------------------------------------------------------------
print("\n--- push ---")
workout_id = str(uuid.uuid7()) if hasattr(uuid, "uuid7") else str(uuid.uuid4())
we_id = str(uuid.uuid4())
set_id = str(uuid.uuid4())
now = int(time.time() * 1000)

mutations = [
    {"clientSeq": 1, "table": "workouts", "rowId": workout_id, "op": "upsert", "updatedAt": now,
     "payload": {"id": workout_id, "name": "Push Day", "startedAt": now, "finishedAt": now + 3600000,
                 "durationSeconds": 3600, "totalVolumeKg": 5400, "totalSets": 12, "totalReps": 96,
                 "prCount": 1, "createdAt": now, "updatedAt": now, "deletedAt": None}},
    {"clientSeq": 2, "table": "workout_exercises", "rowId": we_id, "op": "upsert", "updatedAt": now,
     "payload": {"id": we_id, "workoutId": workout_id, "exerciseId": "bench-press-barbell",
                 "position": 1, "createdAt": now, "updatedAt": now, "deletedAt": None}},
    {"clientSeq": 3, "table": "workout_sets", "rowId": set_id, "op": "upsert", "updatedAt": now,
     "payload": {"id": set_id, "workoutExerciseId": we_id, "position": 1, "setType": "normal",
                 "weightKg": 100, "reps": 5, "isCompleted": True, "completedAt": now,
                 "createdAt": now, "updatedAt": now, "deletedAt": None}},
]

status, body = call("/api/sync/push", {"mutations": mutations, "deviceId": "device-a"}, token_a)
check("push accepted", status in (200, 201), f"status {status}: {body}")
check("all three mutations applied", body.get("applied") == [1, 2, 3], str(body.get("applied")))
check("no conflicts on first push", body.get("conflicts") == [], str(body.get("conflicts")))

# --------------------------------------------------------------------------
print("\n--- pull ---")
status, pulled = call("/api/sync/pull", {"cursor": None, "limit": 100}, token_a)
check("pull succeeded", status in (200, 201), f"status {status}")

changes = pulled.get("changes", {})
check("workout returned", len(changes.get("workouts", [])) == 1)
check("workout_exercise returned", len(changes.get("workout_exercises", [])) == 1)
check("set returned", len(changes.get("workout_sets", [])) == 1)

w = (changes.get("workouts") or [{}])[0]
check("workout fields round-tripped", w.get("name") == "Push Day" and w.get("totalVolumeKg") == 5400, str(w))
check("server-internal userId stripped from payload", "userId" not in w, str(list(w.keys())))
check("server-internal seq stripped from payload", "seq" not in w, str(list(w.keys())))

cursor = pulled.get("cursor")
check("cursor advanced past zero", cursor and int(cursor) > 0, str(cursor))

# --------------------------------------------------------------------------
print("\n--- incremental pull ---")
status, empty = call("/api/sync/pull", {"cursor": cursor, "limit": 100}, token_a)
total_rows = sum(len(v) for v in empty.get("changes", {}).values())
check("pull from latest cursor returns nothing new", total_rows == 0, f"{total_rows} rows")

# --------------------------------------------------------------------------
print("\n--- idempotency ---")
status, replay = call("/api/sync/push", {"mutations": mutations, "deviceId": "device-a"}, token_a)
check("replayed push is acknowledged", replay.get("applied") == [1, 2, 3], str(replay.get("applied")))
check("replay creates no conflicts", replay.get("conflicts") == [], str(replay.get("conflicts")))

status, after_replay = call("/api/sync/pull", {"cursor": cursor, "limit": 100}, token_a)
replay_rows = sum(len(v) for v in after_replay.get("changes", {}).values())
check("replay did not bump seq (no phantom changes)", replay_rows == 0, f"{replay_rows} rows")

# --------------------------------------------------------------------------
print("\n--- last-write-wins ---")
stale = [{"clientSeq": 10, "table": "workouts", "rowId": workout_id, "op": "upsert",
          "updatedAt": now - 60000,
          "payload": {"id": workout_id, "name": "STALE OVERWRITE", "startedAt": now,
                      "createdAt": now, "updatedAt": now - 60000, "deletedAt": None}}]
status, body = call("/api/sync/push", {"mutations": stale, "deviceId": "device-b"}, token_a)
conflicts = body.get("conflicts", [])
check("older write is rejected as stale", len(conflicts) == 1 and conflicts[0]["reason"] == "stale", str(conflicts))
check("stale conflict returns the winning server row",
      conflicts and conflicts[0].get("serverRow", {}).get("name") == "Push Day",
      str(conflicts[0].get("serverRow", {}).get("name") if conflicts else None))

newer = [{"clientSeq": 11, "table": "workouts", "rowId": workout_id, "op": "upsert",
          "updatedAt": now + 60000,
          "payload": {"id": workout_id, "name": "Push Day (renamed)", "startedAt": now,
                      "createdAt": now, "updatedAt": now + 60000, "deletedAt": None}}]
status, body = call("/api/sync/push", {"mutations": newer, "deviceId": "device-b"}, token_a)
check("newer write is applied", body.get("applied") == [11], str(body))

status, pulled2 = call("/api/sync/pull", {"cursor": cursor, "limit": 100}, token_a)
renamed = (pulled2.get("changes", {}).get("workouts") or [{}])[0]
check("rename visible on next pull", renamed.get("name") == "Push Day (renamed)", str(renamed.get("name")))

# --------------------------------------------------------------------------
print("\n--- tenant isolation ---")
status, other = call("/api/sync/pull", {"cursor": None, "limit": 100}, token_b)
other_rows = sum(len(v) for v in other.get("changes", {}).values())
check("second user sees none of the first user's data", other_rows == 0, f"{other_rows} rows")

hijack = [{"clientSeq": 1, "table": "workouts", "rowId": workout_id, "op": "upsert",
           "updatedAt": now + 999999,
           "payload": {"id": workout_id, "name": "HIJACKED", "startedAt": now,
                       "createdAt": now, "updatedAt": now + 999999, "deletedAt": None}}]
status, body = call("/api/sync/push", {"mutations": hijack, "deviceId": "device-x"}, token_b)
conflicts = body.get("conflicts", [])
check("cannot write to another user's row", len(conflicts) == 1 and conflicts[0]["reason"] == "forbidden", str(conflicts))

status, verify = call("/api/sync/pull", {"cursor": cursor, "limit": 100}, token_a)
still = (verify.get("changes", {}).get("workouts") or [{}])[0]
check("victim's row is unchanged after hijack attempt", still.get("name") == "Push Day (renamed)", str(still.get("name")))

# --------------------------------------------------------------------------
print("\n--- soft delete ---")
delete = [{"clientSeq": 20, "table": "workout_sets", "rowId": set_id, "op": "delete",
           "updatedAt": now + 120000, "payload": None}]
status, body = call("/api/sync/push", {"mutations": delete, "deviceId": "device-a"}, token_a)
check("delete accepted", body.get("applied") == [20], str(body))

status, after_delete = call("/api/sync/pull", {"cursor": cursor, "limit": 100}, token_a)
sets = after_delete.get("changes", {}).get("workout_sets", [])
check("tombstone replicates rather than vanishing", len(sets) == 1, f"{len(sets)} rows")
check("tombstone carries deletedAt", sets and sets[0].get("deletedAt") is not None, str(sets[0] if sets else None))

# --------------------------------------------------------------------------
print("\n--- unknown table rejected ---")
bad = [{"clientSeq": 30, "table": "workouts", "rowId": str(uuid.uuid4()), "op": "upsert",
        "updatedAt": now, "payload": {"id": str(uuid.uuid4()), "name": "x", "startedAt": now,
                                      "createdAt": now, "updatedAt": now, "evil_column": "drop table"}}]
status, body = call("/api/sync/push", {"mutations": bad, "deviceId": "device-a"}, token_a)
check("unknown columns are stripped, not fatal", body.get("applied") == [30], str(body))

print("\n" + "=" * 60)
print(f"{len(passes)} passed, {len(failures)} failed")
if failures:
    for name in failures:
        print(f"  FAILED: {name}")
    raise SystemExit(1)
