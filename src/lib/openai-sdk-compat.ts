type UsageDetailsRecord = Record<string, number>;

type ParseMethod<T = unknown> = (input: unknown, ...args: any[]) => T;

interface SchemaLike<T = unknown> {
  parse: ParseMethod<T>;
  safeParse?: ParseMethod<T>;
  parseAsync?: ParseMethod<Promise<T>>;
  safeParseAsync?: ParseMethod<Promise<T>>;
}

interface OpenAIProtocolModule {
  protocol?: {
    StreamEventResponseCompleted?: SchemaLike;
  };
}

let responseUsageCompatPatchApplied = false;

function sanitizeUsageDetailsRecord(value: unknown): UsageDetailsRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entryValue]) =>
        typeof entryValue === 'number' && Number.isFinite(entryValue),
    ),
  );
}

function sanitizeUsageDetailsCollection(
  value: unknown,
): UsageDetailsRecord | UsageDetailsRecord[] | undefined {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeUsageDetailsRecord(entry));
  }

  if (value && typeof value === 'object') {
    return sanitizeUsageDetailsRecord(value);
  }

  return undefined;
}

function sanitizeRequestUsageEntry(entry: unknown): unknown {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return entry;
  }

  const candidate = entry as Record<string, unknown>;
  return {
    ...candidate,
    inputTokensDetails: sanitizeUsageDetailsRecord(
      candidate.inputTokensDetails,
    ),
    outputTokensDetails: sanitizeUsageDetailsRecord(
      candidate.outputTokensDetails,
    ),
  };
}

export function sanitizeOpenAIResponseDoneEventUsage(event: unknown): unknown {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return event;
  }

  const candidate = event as Record<string, unknown>;
  if (candidate.type !== 'response_done') {
    return event;
  }

  const response =
    candidate.response && typeof candidate.response === 'object'
      ? (candidate.response as Record<string, unknown>)
      : null;
  const usage =
    response?.usage && typeof response.usage === 'object'
      ? (response.usage as Record<string, unknown>)
      : null;

  if (!response || !usage) {
    return event;
  }

  return {
    ...candidate,
    response: {
      ...response,
      usage: {
        ...usage,
        inputTokensDetails: sanitizeUsageDetailsCollection(
          usage.inputTokensDetails,
        ),
        outputTokensDetails: sanitizeUsageDetailsCollection(
          usage.outputTokensDetails,
        ),
        requestUsageEntries: Array.isArray(usage.requestUsageEntries)
          ? usage.requestUsageEntries.map((entry) =>
              sanitizeRequestUsageEntry(entry),
            )
          : usage.requestUsageEntries,
      },
    },
  };
}

function patchSchemaParseMethod(
  schema: SchemaLike,
  methodName: keyof SchemaLike,
): void {
  const original = schema[methodName];
  if (typeof original !== 'function') {
    return;
  }

  const boundOriginal = original.bind(schema) as ParseMethod;
  schema[methodName] = ((input: unknown, ...args: any[]) =>
    boundOriginal(sanitizeOpenAIResponseDoneEventUsage(input), ...args)) as any;
}

export function applyOpenAIResponsesUsageCompatPatch(
  sdkModule: OpenAIProtocolModule,
): void {
  if (responseUsageCompatPatchApplied) {
    return;
  }

  const schema = sdkModule.protocol?.StreamEventResponseCompleted;
  if (!schema) {
    return;
  }

  patchSchemaParseMethod(schema, 'parse');
  patchSchemaParseMethod(schema, 'safeParse');
  patchSchemaParseMethod(schema, 'parseAsync');
  patchSchemaParseMethod(schema, 'safeParseAsync');

  responseUsageCompatPatchApplied = true;
}
