/**
 * Subsonic response envelope and JSON/XML serializer.
 *
 * Critical quirk: In Subsonic JSON responses, single-element arrays are
 * collapsed to bare objects, and empty arrays are omitted entirely.
 * We implement a custom serializer to handle this.
 */

const API_VERSION = '1.16.1';
const SERVER_TYPE = 'CloudflareMusic';
const SERVER_VERSION = '0.1.0';

export function subsonicResponse(format: 'json' | 'xml', data: Record<string, unknown> = {}): Response {
  const envelope = {
    status: 'ok',
    version: API_VERSION,
    type: SERVER_TYPE,
    serverVersion: SERVER_VERSION,
    openSubsonic: true,
    ...data,
  };

  if (format === 'json') {
    return jsonResponse(envelope);
  }
  return xmlResponse(envelope);
}

export function subsonicError(format: 'json' | 'xml', code: number, message: string): Response {
  const envelope = {
    status: 'failed',
    version: API_VERSION,
    type: SERVER_TYPE,
    serverVersion: SERVER_VERSION,
    openSubsonic: true,
    error: { code, message },
  };

  if (format === 'json') {
    return jsonResponse(envelope);
  }
  return xmlResponse(envelope);
}

function jsonResponse(envelope: Record<string, unknown>): Response {
  const body = JSON.stringify({ 'subsonic-response': cleanJson(envelope) });
  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * Clean JSON output for Subsonic responses.
 * Strips `_text` keys (XML-only) and removes null/undefined values.
 *
 * NOTE: The original Subsonic spec collapses single-element arrays to bare
 * objects and omits empty arrays. However, most real clients (Sublime Music,
 * DSub, Symphonium) cannot handle this and expect stable arrays. Navidrome
 * (the most popular Subsonic server) also does NOT collapse arrays.
 * So we keep arrays as-is for maximum client compatibility.
 */
function cleanJson(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(cleanJson);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (key === '_text') continue; // XML-only field
      const cleaned = cleanJson(value);
      if (cleaned !== undefined) {
        result[key] = cleaned;
      }
    }
    return result;
  }
  return obj;
}

function xmlResponse(envelope: Record<string, unknown>): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${toXml('subsonic-response', envelope, { xmlns: 'http://subsonic.org/restapi' })}`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

function toXml(tag: string, obj: unknown, extraAttrs?: Record<string, string>): string {
  if (obj === null || obj === undefined) return '';

  if (Array.isArray(obj)) {
    return obj.map(item => toXml(tag, item)).join('\n');
  }

  if (typeof obj !== 'object') {
    return `<${tag}>${escapeXml(String(obj))}</${tag}>`;
  }

  const record = obj as Record<string, unknown>;
  const attrs: string[] = [];
  const children: string[] = [];
  let textContent: string | null = null;

  // Add extra attributes (like xmlns)
  if (extraAttrs) {
    for (const [key, value] of Object.entries(extraAttrs)) {
      attrs.push(`${key}="${escapeXml(value)}"`);
    }
  }

  // If _text is present, skip 'value' key in XML (it's only for JSON)
  const hasTextContent = '_text' in record;

  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;

    // Special key: _text becomes the text content of the element
    // Used for elements like <genre songCount="1">Rock</genre>
    if (key === '_text') {
      textContent = String(value);
    } else if (key === 'value' && hasTextContent) {
      // Skip 'value' attribute in XML when _text provides the text content
      continue;
    } else if (Array.isArray(value)) {
      // Arrays become repeated child elements
      for (const item of value) {
        children.push(toXml(key, item));
      }
    } else if (typeof value === 'object') {
      children.push(toXml(key, value));
    } else {
      // Primitives become attributes
      attrs.push(`${key}="${escapeXml(String(value))}"`);
    }
  }

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

  if (textContent !== null) {
    return `<${tag}${attrStr}>${escapeXml(textContent)}</${tag}>`;
  }

  if (children.length === 0) {
    return `<${tag}${attrStr}/>`;
  }

  return `<${tag}${attrStr}>\n${children.join('\n')}\n</${tag}>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
