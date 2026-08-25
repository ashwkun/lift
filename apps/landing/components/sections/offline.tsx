import { Reveal } from "@/components/site/reveal";

/*
 * Set as a page of a manual, not as a grid of cards.
 *
 * This was six equal cells with a number, a heading and a paragraph, which is
 * the single most recognisable shape on the internet and reads as filled-in
 * template whatever the border radius. The claims have not changed; what
 * changed is that they are now prose with run-in heads, flowing down two
 * columns, which is how a specification has been set since long before there
 * were cards to put one in.
 *
 * The run-in head is doing the work a card's heading used to: it is scannable
 * because it is bold and it starts the line, and it costs no box, no rule and
 * no number to be that.
 */
const GUARANTEES = [
  {
    lead: "It works with the network off.",
    body: "Not degraded, not read-only. Nothing has to be fetched between a rep and its record, so there is no spinner to sit through and nothing that can fail.",
  },
  {
    lead: "Force-quitting mid set loses nothing.",
    body: "The session you are in is written down as you go rather than held in memory. Open the app again and it is still running, on the set you were on.",
  },
  {
    lead: "Nothing comes back on its own.",
    body: "Delete a workout on one phone and it stays deleted on the other. Whatever you got rid of does not quietly reappear the next time the two of them talk.",
  },
  {
    lead: "Kilograms in, pounds out.",
    body: "Switch units whenever you like. It changes what you read, never what was recorded, so nothing already in your history shifts underneath you.",
  },
  {
    lead: "Warm-up sets do not count.",
    body: "They stay out of volume, out of your estimated one rep max and out of personal records. Counting them would inflate every figure in the app.",
  },
  {
    lead: "Nothing in here wants your attention.",
    body: "No ads, no upsell, no feed, no streak to protect. It is open source end to end, which is also what stops any of that arriving in a later version.",
  },
];

export function Offline() {
  return (
    <section id="offline" className="border-b border-line py-24 sm:py-32">
      <div className="shell">
        {/*
          Headline and lede side by side rather than stacked. Every other
          opener on this page puts the lede under the headline; putting them
          in one row here is what stops the six sections opening identically.
        */}
        <div className="grid gap-8 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:items-end md:gap-12 lg:gap-20">
          <h2 className="display text-[clamp(2rem,4.4vw,3.5rem)]">
            It all lives on your phone. Everything else follows from that
            <span className="text-volt">.</span>
          </h2>
          <p className="max-w-[52ch] leading-[1.7] text-fg-2 lg:pb-2">
            Local-first is not a marketing position here, it is where your
            training physically is. Six things that follow from it, none of
            which you have to take on trust.
          </p>
        </div>

        <Reveal className="mt-16 sm:mt-20 lg:columns-2 lg:gap-20">
          {GUARANTEES.map((item) => (
            <p
              key={item.lead}
              className="mb-9 break-inside-avoid text-[1.0625rem] leading-[1.75] text-fg-2 last:mb-0"
            >
              <strong className="font-semibold text-fg">{item.lead}</strong>{" "}
              {item.body}
            </p>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
