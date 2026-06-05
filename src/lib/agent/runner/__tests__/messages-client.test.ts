import {
  assembleStream,
  MessagesApiError,
  type MessagesToolUseBlock,
} from '../messages-client';

async function* events(list: unknown[]): AsyncGenerator<any> {
  for (const e of list) {
    await Promise.resolve();
    yield e;
  }
}

describe('assembleStream', () => {
  it('assembles a text-only turn and forwards deltas', async () => {
    const deltas: string[] = [];
    const result = await assembleStream(
      events([
        { type: 'message_start', message: { usage: { input_tokens: 10 } } },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: ' world' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 5 },
        },
        { type: 'message_stop' },
      ]),
      { onTextDelta: (t) => deltas.push(t) },
    );

    expect(result.content).toEqual([{ type: 'text', text: 'Hello world' }]);
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
    expect(deltas).toEqual(['Hello', ' world']);
  });

  it('assembles a tool_use block with incrementally-streamed JSON input', async () => {
    const result = await assembleStream(
      events([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tu_1', name: 'Read' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"file":' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '"a.ts"}' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
        { type: 'message_stop' },
      ]),
    );

    expect(result.stopReason).toBe('tool_use');
    const block = result.content[0] as MessagesToolUseBlock;
    expect(block).toMatchObject({ type: 'tool_use', id: 'tu_1', name: 'Read' });
    expect(block.input).toEqual({ file: 'a.ts' });
  });

  it('throws on an SSE error event', async () => {
    await expect(
      assembleStream(
        events([{ type: 'error', error: { message: 'overloaded' } }]),
      ),
    ).rejects.toBeInstanceOf(MessagesApiError);
  });
});
