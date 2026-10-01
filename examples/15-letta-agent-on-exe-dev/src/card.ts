import type { AgentCard } from "@a2a-js/sdk";

/**
 * Describes what agentgateway enforces in front of Scooter: clients only ever
 * reach the agent through the gateway. Requirements stay empty because the
 * spec-correct ProtoJSON form breaks the a2a CLI 0.3.0 card parser (Example 13).
 */
export const GATEWAY_API_KEY_SECURITY: Pick<
  AgentCard,
  "securitySchemes" | "securityRequirements"
> = {
  securitySchemes: {
    gatewayApiKey: {
      scheme: {
        $case: "apiKeySecurityScheme",
        value: {
          description: "API key issued by the agentgateway operator.",
          location: "header",
          name: "X-API-Key",
        },
      },
    },
  },
  securityRequirements: [],
};

/** Luna is fast and cheap: pitch Scooter as the high-volume text worker. */
export function applyScooterCard(card: AgentCard): void {
  card.description =
    "Fast, low-cost text worker for high-volume jobs: classify, tag, extract, and draft short text so stronger (pricier) agents don't have to. Remembers your label sets and style rules within a conversation. Not for live data or deep research.";
  card.provider = {
    organization: "letta-a2a",
    url: "https://github.com/klittle32/letta-a2a",
  };
  card.defaultInputModes = ["text/plain"];
  card.defaultOutputModes = ["text/plain"];
  card.skills = [
    skill(
      "classify",
      "Classify and tag",
      "Labels text against your categories: sentiment, intent, topic, urgency, spam, or any custom label set. Cheap enough to run on every item in a queue.",
      ["classification", "tagging", "triage"],
      [
        "Classify each line as bug, feature, or question: ...",
        "Tag this support email with urgency (low/medium/high) and team.",
      ],
    ),
    skill(
      "extract",
      "Extract structured data",
      "Pulls fields such as names, dates, amounts, SKUs, or action items out of messy text and returns JSON in the shape you give it.",
      ["extraction", "json", "parsing"],
      [
        "Extract {vendor, date, total} as JSON from this receipt text: ...",
        "List every action item and owner from these meeting notes as JSON.",
      ],
    ),
    skill(
      "generate",
      "Draft short text at volume",
      "Writes titles, summaries, product blurbs, reply drafts, alt text, and A/B variations quickly and consistently.",
      ["generation", "summarization", "copywriting"],
      [
        "Write 5 subject-line variations for this announcement.",
        "Summarize each of these reviews in one sentence.",
      ],
    ),
    skill(
      "normalize",
      "Clean up and normalize",
      "Rewrites inconsistent text into a standard form: fixes casing, units, and formatting, dedupes near-identical items, and maps free text to canonical values.",
      ["normalization", "cleanup", "deduplication"],
      ["Normalize these product names to 'Brand Model Size' form: ..."],
    ),
  ];
}

function skill(
  id: string,
  name: string,
  description: string,
  tags: string[],
  examples: string[],
): AgentCard["skills"][number] {
  return {
    id,
    name,
    description,
    tags,
    examples,
    inputModes: ["text/plain"],
    outputModes: ["text/plain"],
    securityRequirements: [],
  };
}
