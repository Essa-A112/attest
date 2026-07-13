/**
 * The single provider interface every model call in Attest goes through.
 * Hard rules enforced at this boundary:
 *  - server-side only (this module must never be imported from client code)
 *  - no tools are ever passed to generation calls
 *  - prompts/keys never reach the client; callers log via generation_runs, not console
 */
export type PassKind = "passA" | "passB" | "passC" | "judge";

export interface CompletionRequest {
  kind: PassKind;
  model: string;
  system: string;
  /** User content; any untrusted document inside must already be fenced. */
  user: string;
  maxTokens: number;
  /** JSON schema the output must conform to (enforced server-side by the API). */
  schema: Record<string, unknown>;
}

export interface CompletionResult {
  /** Raw model output text (a JSON document when schema is set). */
  text: string;
  /** Exact model that served the request, for generation_runs. */
  modelVersion: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

class AnthropicProvider implements LlmProvider {
  constructor(private readonly apiKey: string) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });

    const started = Date.now();
    const res = await client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      output_config: {
        format: { type: "json_schema", schema: req.schema },
      },
      // Deliberately: no `tools`. Generation calls run no tools (hard rule).
    });
    const latencyMs = Date.now() - started;

    if (res.stop_reason === "refusal") {
      throw new Error(`model refused ${req.kind} request`);
    }
    if (res.stop_reason === "max_tokens") {
      throw new Error(`model output truncated at max_tokens for ${req.kind}`);
    }
    const text = res.content.find(
      (b): b is Extract<(typeof res.content)[number], { type: "text" }> =>
        b.type === "text",
    )?.text;
    if (!text) throw new Error(`model returned no text for ${req.kind}`);

    return {
      text,
      modelVersion: res.model,
      latencyMs,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  }
}

export class ScriptedProvider implements LlmProvider {
  private readonly queue: string[];
  public readonly requests: CompletionRequest[] = [];

  constructor(responses: string[]) {
    this.queue = [...responses];
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(req);
    const text = this.queue.shift();
    if (text === undefined) throw new Error("ScriptedProvider: no responses left");
    return {
      text,
      modelVersion: `${req.model}-scripted`,
      latencyMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

export async function getProvider(): Promise<LlmProvider> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) return new AnthropicProvider(apiKey);
  if (process.env.NODE_ENV === "production") {
    throw new Error("ANTHROPIC_API_KEY is required in production");
  }
  // Dev/CI without a key: deterministic stub so the product flow still works.
  const { DevStubProvider } = await import("./dev-stub");
  return new DevStubProvider();
}
