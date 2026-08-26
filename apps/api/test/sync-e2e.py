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

# --------------------------------------------------------------------------
# One bad mutation used to take the whole batch with it. Postgres marks a
# transaction aborted on the first error, so the per-mutation try/catch caught
# an error the transaction had already given up on: every later statement
# failed with 25P02, COMMIT threw, and the client got a 500 with nothing
# applied. Each mutation now runs in its own SAVEPOINT.
print("\n--- batch isolation ---")
status, before = call("/api/sync/status", None, token_a, method="GET")
isolation_cursor = before.get("cursor")

good_one = str(uuid.uuid4())
poison = str(uuid.uuid4())
good_two = str(uuid.uuid4())
batch = [
    {"clientSeq": 50, "table": "workouts", "rowId": good_one, "op": "upsert", "updatedAt": now + 200000,
     "payload": {"id": good_one, "name": "Before The Poison", "startedAt": now,
                 "createdAt": now, "updatedAt": now + 200000, "deletedAt": None}},
    # `name` is NOT NULL with no default, so omitting it is a write the schema
    # refuses. This is the mutation that used to discard the other two.
    {"clientSeq": 51, "table": "workouts", "rowId": poison, "op": "upsert", "updatedAt": now + 200000,
     "payload": {"id": poison, "startedAt": now,
                 "createdAt": now, "updatedAt": now + 200000, "deletedAt": None}},
    {"clientSeq": 52, "table": "workouts", "rowId": good_two, "op": "upsert", "updatedAt": now + 200000,
     "payload": {"id": good_two, "name": "After The Poison", "startedAt": now,
                 "createdAt": now, "updatedAt": now + 200000, "deletedAt": None}},
]
status, body = call("/api/sync/push", {"mutations": batch, "deviceId": "device-a"}, token_a)
check("a batch with one bad mutation is not a 500", status in (200, 201), f"status {status}: {body}")
check("the good mutations either side of it applied", body.get("applied") == [50, 52], str(body.get("applied")))
conflicts = body.get("conflicts", [])
check("the bad one is reported as invalid, alone",
      len(conflicts) == 1 and conflicts[0]["clientSeq"] == 51 and conflicts[0]["reason"] == "invalid",
      str(conflicts))

# The response claiming success is not the same as the rows being committed:
# the old code reported applied=[50] and then rolled all of it back.
status, landed = call("/api/sync/pull", {"cursor": isolation_cursor, "limit": 100}, token_a)
names = {w.get("name") for w in landed.get("changes", {}).get("workouts", [])}
check("both good rows are readable afterwards, not just acknowledged",
      {"Before The Poison", "After The Poison"} <= names, str(names))

# A retry of the same batch must not double-apply the two that landed.
status, retried = call("/api/sync/push", {"mutations": batch, "deviceId": "device-a"}, token_a)
check("replaying the batch re-acknowledges without re-applying",
      retried.get("applied") == [50, 52], str(retried.get("applied")))

# --------------------------------------------------------------------------
# `updatedAt` is authored by a device whose clock the user can set. A row
# stamped far in the future used to win every comparison forever, and the
# client answers `stale` by destroying its own copy of the edit.
print("\n--- clock skew ---")
skewed_id = str(uuid.uuid4())
ten_years = now + 10 * 365 * 24 * 60 * 60 * 1000
status, cursor_body = call("/api/sync/status", None, token_a, method="GET")
skew_cursor = cursor_body.get("cursor")

skewed = [{"clientSeq": 60, "table": "workouts", "rowId": skewed_id, "op": "upsert",
           "updatedAt": ten_years,
           "payload": {"id": skewed_id, "name": "From A Fast Clock", "startedAt": now,
                       "createdAt": now, "updatedAt": ten_years, "deletedAt": None}}]
status, body = call("/api/sync/push", {"mutations": skewed, "deviceId": "device-fast"}, token_a)
check("a write from a skewed clock is still accepted", body.get("applied") == [60], str(body))
server_time = body.get("serverTime", 0)

status, stored = call("/api/sync/pull", {"cursor": skew_cursor, "limit": 100}, token_a)
row = next((w for w in stored.get("changes", {}).get("workouts", []) if w.get("id") == skewed_id), {})
tolerance = 5 * 60 * 1000
check("it is stored clamped, not ten years into the future",
      row.get("updatedAt") is not None and row["updatedAt"] <= server_time + tolerance + 5000,
      f"stored {row.get('updatedAt')} against a ceiling of {server_time + tolerance}")
check("the clamp actually moved it", row.get("updatedAt", 0) < ten_years, str(row.get("updatedAt")))

# --------------------------------------------------------------------------
# Each table is capped at `limit` rows independently, then the merged list is
# cut. When one table fills its cap and the others are empty the merged length
# lands on `limit` exactly, and `collected.length > limit` read as "caught up"
# while rows sat past the cursor.
print("\n--- short page boundary ---")
token_c = signup(f"c-{uuid.uuid4().hex[:8]}@example.com")
page = 5
measurements = []
for i in range(page + 3):
    mid = str(uuid.uuid4())
    measurements.append(
        {"clientSeq": 100 + i, "table": "body_measurements", "rowId": mid, "op": "upsert",
         "updatedAt": now + i,
         "payload": {"id": mid, "kind": "weight", "value": 80 + i, "measuredAt": now + i,
                     "createdAt": now, "updatedAt": now + i, "deletedAt": None}})
status, body = call("/api/sync/push", {"mutations": measurements, "deviceId": "device-c"}, token_c)
check("seeded a single table past one page", len(body.get("applied", [])) == page + 3, str(body.get("applied")))

status, first = call("/api/sync/pull", {"cursor": None, "limit": page}, token_c)
returned = len(first.get("changes", {}).get("body_measurements", []))
check("a full page returns exactly the limit", returned == page, f"{returned} rows")
check("and reports that more remain", first.get("hasMore") is True, str(first.get("hasMore")))

status, second = call("/api/sync/pull", {"cursor": first.get("cursor"), "limit": page}, token_c)
rest = len(second.get("changes", {}).get("body_measurements", []))
check("the remainder arrives on the next page", rest == 3, f"{rest} rows")
check("and the pull terminates", second.get("hasMore") is False, str(second.get("hasMore")))

# --------------------------------------------------------------------------
# Two mutations for one row in one batch. `trackDelete` does not coalesce an
# earlier upsert the way `trackUpsertCoalesced` does, so logging a set and then
# removing it sends both. If the two end up with the same effective timestamp
# the delete ties, loses to the incumbent, and comes back as `stale` with the
# live row: the client then stores that row, drops the delete from its oplog,
# and the set the user removed is back for good.
#
# Two ways to produce the tie, both covered: identical raw timestamps (two
# writes inside one millisecond), and a clock far enough ahead that clamping
# maps every timestamp in the batch onto the same ceiling.
print("\n--- same row twice in one batch ---")

def upsert_then_delete(label, stamp_a, stamp_b, seq_base, token):
    row = str(uuid.uuid4())
    pair = [
        {"clientSeq": seq_base, "table": "workouts", "rowId": row, "op": "upsert",
         "updatedAt": stamp_a,
         "payload": {"id": row, "name": label, "startedAt": now,
                     "createdAt": now, "updatedAt": stamp_a, "deletedAt": None}},
        {"clientSeq": seq_base + 1, "table": "workouts", "rowId": row, "op": "delete",
         "updatedAt": stamp_b, "payload": None},
    ]
    status, body = call("/api/sync/push", {"mutations": pair, "deviceId": "device-pair"}, token)
    return row, body

token_d = signup(f"d-{uuid.uuid4().hex[:8]}@example.com")

# 1. Identical timestamps, no skew involved.
row_tie, body = upsert_then_delete("Tied Timestamps", now, now, 200, token_d)
check("both halves of an upsert-then-delete pair are applied",
      body.get("applied") == [200, 201], f"applied={body.get('applied')} conflicts={body.get('conflicts')}")

status, pulled = call("/api/sync/pull", {"cursor": None, "limit": 100}, token_d)
row = next((w for w in pulled.get("changes", {}).get("workouts", []) if w.get("id") == row_tie), None)
check("the delete wins the tie rather than resurrecting the row",
      row is not None and row.get("deletedAt") is not None,
      f"deletedAt={row.get('deletedAt') if row else 'row missing'}")

# 2. A clock far enough ahead that both timestamps clamp to the same ceiling.
token_e = signup(f"e-{uuid.uuid4().hex[:8]}@example.com")
far = now + 10 * 365 * 24 * 60 * 60 * 1000
row_skew, body = upsert_then_delete("Fast Clock Pair", far, far + 1000, 300, token_e)
check("a skewed clock's pair is applied too",
      body.get("applied") == [300, 301], f"applied={body.get('applied')} conflicts={body.get('conflicts')}")

status, pulled = call("/api/sync/pull", {"cursor": None, "limit": 100}, token_e)
row = next((w for w in pulled.get("changes", {}).get("workouts", []) if w.get("id") == row_skew), None)
check("clamping to a shared ceiling does not resurrect the deleted row",
      row is not None and row.get("deletedAt") is not None,
      f"deletedAt={row.get('deletedAt') if row else 'row missing'}")
check("and the tombstone is still stored clamped",
      row is not None and row.get("updatedAt", 0) < far,
      str(row.get("updatedAt") if row else None))

# --------------------------------------------------------------------------
# The client declares eleven foreign keys and runs with PRAGMA foreign_keys=ON;
# the server declared none, so a set whose workout never arrived was accepted
# here and could never be applied there. `missing_parent` is the one conflict
# reason the client retries rather than retires, so a late parent has to be
# told apart from a payload the schema refuses.
print("\n--- missing parent ---")
token_f = signup(f"f-{uuid.uuid4().hex[:8]}@example.com")

orphan_parent = str(uuid.uuid4())
orphan_child = str(uuid.uuid4())
sibling = str(uuid.uuid4())

orphan_batch = [
    # The workout this set's exercise belongs to is deliberately never pushed.
    {"clientSeq": 400, "table": "workout_exercises", "rowId": orphan_child, "op": "upsert",
     "updatedAt": now, "payload": {"id": orphan_child, "workoutId": orphan_parent,
                                   "exerciseId": "bench-press-barbell", "position": 1,
                                   "createdAt": now, "updatedAt": now, "deletedAt": None}},
    {"clientSeq": 401, "table": "workouts", "rowId": sibling, "op": "upsert", "updatedAt": now,
     "payload": {"id": sibling, "name": "Unrelated", "startedAt": now,
                 "createdAt": now, "updatedAt": now, "deletedAt": None}},
]
status, body = call("/api/sync/push", {"mutations": orphan_batch, "deviceId": "device-f"}, token_f)
check("a row whose parent is absent is not a 500", status in (200, 201), f"status {status}: {body}")
conflicts = body.get("conflicts", [])
check("it comes back as missing_parent, not invalid",
      len(conflicts) == 1 and conflicts[0]["reason"] == "missing_parent", str(conflicts))
check("the savepoint kept the rest of the batch", body.get("applied") == [401], str(body.get("applied")))

# A missing parent must leave no receipt, or the retry the client is told to
# make would be acknowledged without ever applying the row. The parent arrives
# in a later push, which is the shape the client produces: the rejected entry
# stays in the oplog and goes up again on the next run.
status, body = call("/api/sync/push", {"mutations": [
    {"clientSeq": 402, "table": "workouts", "rowId": orphan_parent, "op": "upsert", "updatedAt": now,
     "payload": {"id": orphan_parent, "name": "The Late Parent", "startedAt": now,
                 "createdAt": now, "updatedAt": now, "deletedAt": None}}],
    "deviceId": "device-f"}, token_f)
check("the late parent lands", body.get("applied") == [402], str(body))

status, body = call("/api/sync/push", {"mutations": [orphan_batch[0]], "deviceId": "device-f"}, token_f)
check("and the retry of the rejected child then applies, having left no receipt",
      body.get("applied") == [400], f"applied={body.get('applied')} conflicts={body.get('conflicts')}")

# Nullable references are enforced too: `routineId` may be null, but a routine
# id that names nothing is the same missing parent.
ghost_routine = [{"clientSeq": 403, "table": "workouts", "rowId": str(uuid.uuid4()), "op": "upsert",
                  "updatedAt": now, "payload": {"id": str(uuid.uuid4()), "name": "From A Ghost Routine",
                                                "routineId": str(uuid.uuid4()), "startedAt": now,
                                                "createdAt": now, "updatedAt": now, "deletedAt": None}}]
status, body = call("/api/sync/push", {"mutations": ghost_routine, "deviceId": "device-f"}, token_f)
conflicts = body.get("conflicts", [])
check("a nullable reference to a row that does not exist is missing_parent too",
      len(conflicts) == 1 and conflicts[0]["reason"] == "missing_parent", str(conflicts))

# The built-in exercise catalog is seeded on device and never pushed, so
# `exercise_id` is deliberately not a foreign key here. If it were, this would
# be rejected and essentially every logged set with it.
catalog_workout = str(uuid.uuid4())
catalog_child = str(uuid.uuid4())
catalog = [
    {"clientSeq": 404, "table": "workouts", "rowId": catalog_workout, "op": "upsert", "updatedAt": now,
     "payload": {"id": catalog_workout, "name": "Catalog Exercise", "startedAt": now,
                 "createdAt": now, "updatedAt": now, "deletedAt": None}},
    {"clientSeq": 405, "table": "workout_exercises", "rowId": catalog_child, "op": "upsert",
     "updatedAt": now, "payload": {"id": catalog_child, "workoutId": catalog_workout,
                                   "exerciseId": "an-exercise-only-the-phone-has", "position": 1,
                                   "createdAt": now, "updatedAt": now, "deletedAt": None}},
]
status, body = call("/api/sync/push", {"mutations": catalog, "deviceId": "device-f"}, token_f)
check("a set naming a built-in exercise the server has never seen still applies",
      body.get("applied") == [404, 405], f"applied={body.get('applied')} conflicts={body.get('conflicts')}")

# --------------------------------------------------------------------------
# Nothing purged a tombstone, so every row the user ever deleted was still
# stored, still indexed and still downloaded in full by every fresh install.
print("\n--- tombstone sweep ---")
token_g = signup(f"g-{uuid.uuid4().hex[:8]}@example.com")

# Stamped in the past: the sweep's horizon is `deletedAt`, and a delete a client
# stamps slightly ahead of the server would not be old enough to purge.
past = now - 600000
gc_workout = str(uuid.uuid4())
gc_child = str(uuid.uuid4())
gc_live = str(uuid.uuid4())

seed = [
    {"clientSeq": 500, "table": "workouts", "rowId": gc_workout, "op": "upsert", "updatedAt": past,
     "payload": {"id": gc_workout, "name": "To Be Deleted", "startedAt": past,
                 "createdAt": past, "updatedAt": past, "deletedAt": None}},
    {"clientSeq": 501, "table": "workout_exercises", "rowId": gc_child, "op": "upsert",
     "updatedAt": past, "payload": {"id": gc_child, "workoutId": gc_workout,
                                    "exerciseId": "bench-press-barbell", "position": 1,
                                    "createdAt": past, "updatedAt": past, "deletedAt": None}},
    {"clientSeq": 502, "table": "workouts", "rowId": gc_live, "op": "upsert", "updatedAt": past,
     "payload": {"id": gc_live, "name": "Still Here", "startedAt": past,
                 "createdAt": past, "updatedAt": past, "deletedAt": None}},
]
status, body = call("/api/sync/push", {"mutations": seed, "deviceId": "device-g"}, token_g)
check("seeded a parent, its child and a live row", len(body.get("applied", [])) == 3, str(body))

# The parent is deleted; the child is not. Purging the parent now would either
# violate the key or, with a cascade, hard-delete a live row that no tombstone
# was ever written for.
status, body = call("/api/sync/push", {"mutations": [
    {"clientSeq": 503, "table": "workouts", "rowId": gc_workout, "op": "delete",
     "updatedAt": past + 1000, "payload": None}], "deviceId": "device-g"}, token_g)
check("the parent is tombstoned", body.get("applied") == [503], str(body))

status, sweep = call("/api/sync/gc", {"retainForDays": 0}, token_g)
check("a sweep is accepted", status in (200, 201), f"status {status}: {sweep}")
check("a tombstone whose child is still live is kept, not purged",
      sweep.get("purged", {}).get("workouts") is None, str(sweep.get("purged")))

status, kept = call("/api/sync/pull", {"cursor": None, "limit": 100}, token_g)
ids = {w.get("id") for w in kept.get("changes", {}).get("workouts", [])}
check("and it is still replicated", gc_workout in ids, str(ids))

# Now the child goes too, so one sweep can take both: children first, then the
# parent nothing references any more.
status, body = call("/api/sync/push", {"mutations": [
    {"clientSeq": 504, "table": "workout_exercises", "rowId": gc_child, "op": "delete",
     "updatedAt": past + 2000, "payload": None}], "deviceId": "device-g"}, token_g)
check("the child is tombstoned", body.get("applied") == [504], str(body))

status, sweep = call("/api/sync/gc", {"retainForDays": 0}, token_g)
check("one sweep removes the child and then the parent",
      sweep.get("purged", {}).get("workout_exercises") == 1
      and sweep.get("purged", {}).get("workouts") == 1, str(sweep.get("purged")))
check("the sweep reports a watermark", int(sweep.get("watermark", 0)) > 0, str(sweep.get("watermark")))

status, fresh = call("/api/sync/pull", {"cursor": None, "limit": 100}, token_g)
workouts_now = fresh.get("changes", {}).get("workouts", [])
check("a fresh install no longer downloads the purged tombstone",
      {w.get("id") for w in workouts_now} == {gc_live}, str([w.get("id") for w in workouts_now]))
check("and the live row is untouched",
      len(workouts_now) == 1 and workouts_now[0].get("name") == "Still Here", str(workouts_now))
check("nor the purged child", len(fresh.get("changes", {}).get("workout_exercises", [])) == 0,
      str(fresh.get("changes", {}).get("workout_exercises")))

# --------------------------------------------------------------------------
# A cursor is a `seq`; the horizon is a date. The only thing the two can be
# compared through is the highest `seq` a sweep actually removed.
print("\n--- purge watermark ---")
token_h = signup(f"h-{uuid.uuid4().hex[:8]}@example.com")

doomed = str(uuid.uuid4())
status, body = call("/api/sync/push", {"mutations": [
    {"clientSeq": 600, "table": "workouts", "rowId": doomed, "op": "upsert", "updatedAt": past,
     "payload": {"id": doomed, "name": "Seen Then Deleted", "startedAt": past,
                 "createdAt": past, "updatedAt": past, "deletedAt": None}}],
    "deviceId": "device-h"}, token_h)
check("seeded a row for the watermark case", body.get("applied") == [600], str(body))

# The device pulls, and stops here. Everything after this it has not seen.
status, seen = call("/api/sync/pull", {"cursor": None, "limit": 100}, token_h)
stale_cursor = seen.get("cursor")

status, body = call("/api/sync/push", {"mutations": [
    {"clientSeq": 601, "table": "workouts", "rowId": doomed, "op": "delete",
     "updatedAt": past + 1000, "payload": None}], "deviceId": "device-h2"}, token_h)
check("another device deletes it", body.get("applied") == [601], str(body))

status, sweep = call("/api/sync/gc", {"retainForDays": 0}, token_h)
watermark = int(sweep.get("watermark", 0))
check("the sweep purged the tombstone", sweep.get("purged", {}).get("workouts") == 1, str(sweep))
check("the watermark is the seq of what it removed, above the stale cursor",
      watermark > int(stale_cursor), f"watermark {watermark} against cursor {stale_cursor}")

status, behind = call("/api/sync/pull", {"cursor": stale_cursor, "limit": 100}, token_h)
check("a pull from below the watermark is answered, not rejected",
      status in (200, 201), f"status {status}: {behind}")
check("it says a resync is required", behind.get("resyncRequired") is True, str(behind))
# What an old client does with that: nothing. It reads `changes` and moves on,
# so it keeps its copy of a row deleted elsewhere. The page must therefore be
# exactly the page it would have received before, or the flag it ignores would
# change behaviour it cannot see.
check("but the page itself is unchanged: no rewind, no error",
      behind.get("cursor") == stale_cursor and behind.get("hasMore") is False
      and sum(len(v) for v in behind.get("changes", {}).values()) == 0,
      str(behind))

status, first_sync = call("/api/sync/pull", {"cursor": None, "limit": 100}, token_h)
check("a first sync is never told to resync", first_sync.get("resyncRequired") is False,
      str(first_sync.get("resyncRequired")))
status, restart = call("/api/sync/pull", {"cursor": "0", "limit": 100}, token_h)
check("nor is a client restarting from zero, which is what makes it loop-free",
      restart.get("resyncRequired") is False, str(restart.get("resyncRequired")))
status, caught_up = call("/api/sync/pull", {"cursor": str(watermark), "limit": 100}, token_h)
check("a cursor at the watermark has missed nothing",
      caught_up.get("resyncRequired") is False, str(caught_up.get("resyncRequired")))

# `seq` is global, so a global watermark would order a resync on every account
# that happened to be quiet while a busy one was swept.
token_i = signup(f"i-{uuid.uuid4().hex[:8]}@example.com")
bystander = str(uuid.uuid4())
status, body = call("/api/sync/push", {"mutations": [
    {"clientSeq": 700, "table": "workouts", "rowId": bystander, "op": "upsert", "updatedAt": past,
     "payload": {"id": bystander, "name": "Somebody Else's", "startedAt": past,
                 "createdAt": past, "updatedAt": past, "deletedAt": None}}],
    "deviceId": "device-i"}, token_i)
status, bystander_pull = call("/api/sync/pull", {"cursor": None, "limit": 100}, token_i)
bystander_cursor = bystander_pull.get("cursor")

# A sweep on the other account, above this one's cursor.
status, body = call("/api/sync/push", {"mutations": [
    {"clientSeq": 602, "table": "workouts", "rowId": str(uuid.uuid4()), "op": "upsert",
     "updatedAt": past, "payload": {"id": doomed, "name": "ignored", "startedAt": past,
                                    "createdAt": past, "updatedAt": past, "deletedAt": None}}],
    "deviceId": "device-h"}, token_h)
status, sweep = call("/api/sync/gc", {"retainForDays": 0}, token_h)

status, unaffected = call("/api/sync/pull", {"cursor": bystander_cursor, "limit": 100}, token_i)
check("one account's sweep does not order a resync on another",
      unaffected.get("resyncRequired") is False, str(unaffected.get("resyncRequired")))
check("and does not remove its rows",
      len(call("/api/sync/pull", {"cursor": None, "limit": 100}, token_i)[1]
          .get("changes", {}).get("workouts", [])) == 1)

# --------------------------------------------------------------------------
# Every push used to load every receipt the device had ever written into a Set,
# from a table nothing deleted from. The read is now scoped to the batch and the
# table is trimmed to a window, which is only safe because a missing receipt
# means "apply it again and let last-write-wins decide", never "already done".
print("\n--- receipt bounds ---")
token_j = signup(f"j-{uuid.uuid4().hex[:8]}@example.com")

old_row = str(uuid.uuid4())
old_mutation = {"clientSeq": 1, "table": "workouts", "rowId": old_row, "op": "upsert",
                "updatedAt": past, "payload": {"id": old_row, "name": "Long Ago", "startedAt": past,
                                               "createdAt": past, "updatedAt": past, "deletedAt": None}}
status, body = call("/api/sync/push", {"mutations": [old_mutation], "deviceId": "device-j"}, token_j)
check("an early mutation applies", body.get("applied") == [1], str(body))

# Far enough past the window that the receipt for clientSeq 1 falls out of it.
recent_row = str(uuid.uuid4())
recent_mutation = {"clientSeq": 20001, "table": "workouts", "rowId": recent_row, "op": "upsert",
                   "updatedAt": past, "payload": {"id": recent_row, "name": "Much Later",
                                                  "startedAt": past, "createdAt": past,
                                                  "updatedAt": past, "deletedAt": None}}
status, body = call("/api/sync/push", {"mutations": [recent_mutation], "deviceId": "device-j"}, token_j)
check("and so does one 20,000 oplog entries later", body.get("applied") == [20001], str(body))

status, body = call("/api/sync/push", {"mutations": [old_mutation], "deviceId": "device-j"}, token_j)
conflicts = body.get("conflicts", [])
check("replaying past the trimmed window is judged on its timestamp, not acknowledged blind",
      body.get("applied") == [] and len(conflicts) == 1 and conflicts[0]["reason"] == "stale",
      f"applied={body.get('applied')} conflicts={conflicts}")
check("and the row it would have rewritten is untouched",
      conflicts and conflicts[0].get("serverRow", {}).get("name") == "Long Ago",
      str(conflicts[0].get("serverRow", {}).get("name") if conflicts else None))

status, body = call("/api/sync/push", {"mutations": [recent_mutation], "deviceId": "device-j"}, token_j)
check("a receipt still inside the window short-circuits as before",
      body.get("applied") == [20001] and body.get("conflicts") == [], str(body))

# The window above already trimmed the receipt for clientSeq 1, so one is left:
# the window bounds a device that is still pushing, and the sweep is what
# reaches a device that has stopped and will never trim itself again.
status, sweep = call("/api/sync/gc", {"retainForDays": 0}, token_j)
check("the sweep clears the receipts a stopped device left behind",
      sweep.get("receiptsRemoved") == 1, str(sweep.get("receiptsRemoved")))

status, body = call("/api/sync/push", {"mutations": [recent_mutation], "deviceId": "device-j"}, token_j)
conflicts = body.get("conflicts", [])
check("a swept receipt falls back to last-write-wins rather than losing the write",
      len(conflicts) == 1 and conflicts[0]["reason"] == "stale", str(body))

status, intact = call("/api/sync/pull", {"cursor": None, "limit": 100}, token_j)
names = sorted(w.get("name") for w in intact.get("changes", {}).get("workouts", []))
check("both rows survived every replay", names == ["Long Ago", "Much Later"], str(names))

print("\n" + "=" * 60)
print(f"{len(passes)} passed, {len(failures)} failed")
if failures:
    for name in failures:
        print(f"  FAILED: {name}")
    raise SystemExit(1)
