// The AI's instructions are the plugin's writing skills (`skills/writing/<name>/SKILL.md`), read
// at every call so an edit applies at once. A missing skill means the short built-in instructions
// in core/ai.ts do.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Instructions } from '../core/ai.ts';

const NAMES: Record<keyof Instructions, string> = {
  proofread: 'proofread', marks: 'marks', shrink: 'shrink', findNotes: 'find-notes', changelog: 'changelog',
};

/** A skill's instructions without its front matter, or undefined. */
export async function readSkill(dir: string, name: string): Promise<string | undefined> {
  try {
    const text = await fs.readFile(path.join(dir, 'writing', name, 'SKILL.md'), 'utf8');
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, '').trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function instructions(dir: string): Promise<Instructions> {
  const out: Instructions = {};
  for (const [key, name] of Object.entries(NAMES)) {
    const text = await readSkill(dir, name);
    if (text) out[key as keyof Instructions] = text;
  }
  return out;
}
