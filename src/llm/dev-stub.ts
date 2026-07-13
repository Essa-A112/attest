import type { CompletionRequest, CompletionResult, LlmProvider } from "./provider";

/**
 * Deterministic stand-in used in dev/CI when no ANTHROPIC_API_KEY is set, so
 * the full product flow (generate -> review -> publish -> attempt) can be
 * exercised without network access. Never used in production: getProvider()
 * throws there instead of falling back.
 */
export class DevStubProvider implements LlmProvider {
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const text = this.respond(req);
    return {
      text,
      modelVersion: "dev-stub",
      latencyMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  private respond(req: CompletionRequest): string {
    switch (req.kind) {
      case "passA":
        return this.extractObligations(req.user);
      case "passB":
        return this.generateQuestions(req.user);
      case "passC":
        return this.checkQuestions(req.user);
      case "judge":
        return JSON.stringify({
          accuracy: 4,
          distractor_plausibility: 3,
          scenario_realism: 3,
          single_defensible_answer: 4,
          notes: "dev-stub: fixed scores, not a real judgement",
        });
    }
  }

  private fencedDocument(user: string): string {
    const match = user.match(/<document-([0-9a-f]+)>\n([\s\S]*)\n<\/document-\1>/);
    return match?.[2] ?? "";
  }

  private extractObligations(user: string): string {
    const doc = this.fencedDocument(user);
    const sentences = doc
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 20);
    const obligationLike = sentences.filter((s) =>
      /\b(must|never|only|shall|required|prohibited|do not|within \d+)\b/i.test(s),
    );
    const picked = (obligationLike.length > 0 ? obligationLike : sentences).slice(0, 10);
    const obligations = picked.flatMap((sentence, i) => {
      const start = doc.indexOf(sentence);
      if (start < 0) return [];
      return [
        {
          id: `OB-${i + 1}`,
          statement: sentence.replace(/\s+/g, " "),
          quote: sentence,
          start,
          end: start + sentence.length,
        },
      ];
    });
    return JSON.stringify({ obligations });
  }

  private generateQuestions(user: string): string {
    const payload = user.match(/<obligations-json>([\s\S]*?)<\/obligations-json>/);
    let obligations: { id: string; statement: string; quote: string }[] = [];
    if (payload?.[1]) {
      try {
        obligations = JSON.parse(payload[1]) as typeof obligations;
      } catch {
        obligations = [];
      }
    }
    const questions = obligations.map((ob, i) => {
      const correct = i % 4;
      const options = [
        "Follow a colleague's informal advice instead.",
        "Postpone action until someone reminds you.",
        "Do whatever seems fastest at the time.",
        "Ignore the situation entirely.",
      ];
      options.splice(correct, 0, `Do what the policy requires: ${ob.statement}`);
      options.length = 4;
      return {
        obligation_id: ob.id,
        scenario: `You face a situation covered by the policy. A colleague suggests improvising. What do you do?`,
        options,
        correct,
        rationale: `The policy states: "${ob.quote}"`,
      };
    });
    return JSON.stringify({ questions });
  }

  private checkQuestions(user: string): string {
    const payload = user.match(/<questions-json>([\s\S]*?)<\/questions-json>/);
    let questions: { obligation_id: string }[] = [];
    if (payload?.[1]) {
      try {
        questions = JSON.parse(payload[1]) as typeof questions;
      } catch {
        questions = [];
      }
    }
    return JSON.stringify({
      results: questions.map((_, i) => ({
        index: i,
        keyed_answer_follows: true,
        distractors_defensible: true,
        notes: "dev-stub: not a real check",
      })),
    });
  }
}
