// Цикл агента: модель -> tool_use -> результат -> модель, до end_turn.

async function callApi(baseUrl, apiKey, body) {
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

const MAX_TURNS = 25;

export async function runAgentTask({ session, baseUrl, apiKey, model, system, tools, executeTool, userText, onText, onTool, onError }) {
  session.messages.push({ role: 'user', content: userText });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await callApi(baseUrl, apiKey, {
      model,
      max_tokens: 4096,
      system,
      tools,
      messages: session.messages,
    });

    session.messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') {
      for (const block of res.content) if (block.type === 'text') onText?.(block.text);
      return;
    }

    const results = [];
    for (const block of res.content) {
      if (block.type === 'text' && block.text.trim()) onText?.(block.text);
      if (block.type === 'tool_use') {
        onTool?.(block.name, block.input);
        let output;
        try {
          output = await executeTool(block.name, block.input);
        } catch (e) {
          output = `ERROR: ${e.message}`;
          onError?.(e);
        }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: String(output).slice(0, 50000) });
      }
    }
    session.messages.push({ role: 'user', content: results });
  }
  onError?.(new Error(`Досягнуто ліміт циклів (${MAX_TURNS}).`));
}
