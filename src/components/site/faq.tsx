import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

export const FAQS: { q: string; a: string }[] = [
  {
    q: "Is Lamp a lender?",
    a: "No. Lamp is a brokerage. We take your file to a network of third-party funders, bring back what they're willing to do, and lay the offers out side by side. The funder you pick is the one that funds you.",
  },
  {
    q: "Does checking my options hurt my credit?",
    a: "No. The questions on this site don't touch your credit, and we never ask for your Social Security number up front. If you decide to move forward with a specific funder, they'll tell you what kind of review they run before they run it.",
  },
  {
    q: "What does it cost to use Lamp?",
    a: "Nothing up front. Checking your options and seeing offers is free. If you accept an offer, every cost and fee is disclosed to you in writing before you sign.",
  },
  {
    q: "How fast can I get funded?",
    a: "Most complete files get offers back the same business day. Once you accept one, many funders can send money within 24–48 hours. A complete file — three months of statements and a clear ID — is the biggest thing that speeds it up.",
  },
  {
    q: "What do I need to apply?",
    a: "Your last three months of business bank statements, a photo of your driver's license, and your business name and EIN. Most owners have everything they need in about ten minutes.",
  },
  {
    q: "What's a factor rate?",
    a: "Many short-term funding products price with a factor rate instead of an interest rate. A factor rate of 1.25 on $40,000 means you pay back $50,000 in total. We always show you the total payback, the payment amount, and how often it's paid, so you can compare offers on the numbers that matter.",
  },
  {
    q: "Can I say no to every offer?",
    a: "Yes. You're never obligated to accept anything. If none of the offers feel right, say no and nothing happens.",
  },
  {
    q: "Who's a good fit?",
    a: "Owner-operators doing roughly $20k to $500k a month who've been open six months or longer — restaurants, trucking, contractors, retail, salons, auto shops, medical and dental offices, and more. Newer or smaller businesses can still check; we'll tell you honestly what's realistic.",
  },
];

export function FaqList({
  items = FAQS,
  dark = false,
}: {
  items?: { q: string; a: string }[];
  /** On the Lamplight (night) ground. */
  dark?: boolean;
}) {
  return (
    <Accordion
      type="single"
      collapsible
      className={cn(
        "divide-y border-y",
        dark ? "divide-white/10 border-white/10" : "divide-line border-line",
      )}
    >
      {items.map((f, i) => (
        <AccordionItem key={f.q} value={`q${i}`} className="border-none">
          <AccordionTrigger
            className={cn(
              "py-5 text-left font-display text-base font-semibold hover:no-underline sm:text-lg",
              dark ? "text-paper [&>svg]:text-leaf" : "text-ink [&>svg]:text-smoke",
            )}
          >
            {f.q}
          </AccordionTrigger>
          <AccordionContent
            className={cn(
              "pb-5 text-sm leading-relaxed sm:text-base",
              dark ? "text-mist" : "text-smoke",
            )}
          >
            {f.a}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
