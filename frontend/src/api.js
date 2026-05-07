async function parseJsonOrThrow(response) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return response.json();
}

export async function uploadReferenceFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });
  return parseJsonOrThrow(response);
}

export async function fetchTemplates() {
  const response = await fetch("/api/templates");
  return parseJsonOrThrow(response);
}

export async function fetchHistory() {
  const response = await fetch("/api/history");
  return parseJsonOrThrow(response);
}

export async function fetchGeneratedPreview(pptFile) {
  const response = await fetch(`/api/generated-preview?ppt_file=${encodeURIComponent(pptFile)}`);
  return parseJsonOrThrow(response);
}

export async function uploadTemplate(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/templates/upload", {
    method: "POST",
    body: formData,
  });
  return parseJsonOrThrow(response);
}

export const uploadTemplatePlaceholder = uploadTemplate;

function parseSSEBlock(block) {
  let event = "message";
  const dataLines = [];

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (!dataLines.length) {
    return null;
  }

  const raw = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: { text: raw } };
  }
}

export async function streamChat(payload, onEvent) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `Chat request failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const parsed = parseSSEBlock(block);
      if (parsed) {
        onEvent(parsed.event, parsed.data);
      }
    }
  }
}
