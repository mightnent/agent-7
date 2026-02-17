import type { AgentMemoryCategory } from "./store";

export interface ExplicitMemoryCandidate {
  category: AgentMemoryCategory;
  content: string;
  conflictHints: string[];
}

const normalizeSentence = (value: string): string => value.replace(/\s+/g, " ").trim();

export const detectExplicitMemory = (message: string): ExplicitMemoryCandidate | null => {
  const list = detectExplicitMemories(message);
  return list[0] ?? null;
};

const asFact = (content: string, conflictHints: string[]): ExplicitMemoryCandidate => ({
  category: "fact",
  content,
  conflictHints,
});

const cleanLeadingAgentName = (text: string): string => {
  return text.replace(/^[a-z][a-z0-9_-]{1,30}[,:\s]+/i, "").trim();
};

const splitStatements = (text: string): string[] => {
  const normalized = text
    .replace(/\bI also\b/gi, ". I also")
    .replace(/\bI am also\b/gi, ". I am also")
    .replace(/\bI handle\b/gi, ". I handle")
    .replace(/\bI work\b/gi, ". I work")
    .replace(/\band also\b/gi, ". also");
  return normalized
    .split(/[.;\n]+/)
    .map((part) => normalizeSentence(part))
    .filter(Boolean);
};

export const detectExplicitMemories = (message: string): ExplicitMemoryCandidate[] => {
  const text = normalizeSentence(message);
  if (!text) {
    return [];
  }
  const cleaned = cleanLeadingAgentName(text);
  const statements = splitStatements(cleaned);
  const results: ExplicitMemoryCandidate[] = [];

  const pushIf = (candidate: ExplicitMemoryCandidate | null) => {
    if (candidate) {
      results.push(candidate);
    }
  };

  for (const statement of statements) {
    const timezoneMatch = statement.match(/(?:my\s+timezone\s+is|i(?:\s*am|')\s+in\s+timezone)\s+(.+)/i);
    if (timezoneMatch?.[1]) {
      const timezone = normalizeSentence(timezoneMatch[1].replace(/[.!?]+$/, ""));
      if (timezone) {
        pushIf(asFact(`User timezone is ${timezone}`, ["timezone"]));
      }
      continue;
    }

    const companyMatch = statement.match(/(?:my\s+company\s+is|our\s+company\s+is|company\s+name\s+is)\s+(.+)/i);
    if (companyMatch?.[1]) {
      const company = normalizeSentence(companyMatch[1].replace(/[.!?]+$/, ""));
      if (company) {
        pushIf(asFact(`User company name is ${company}`, ["company"]));
      }
      continue;
    }

    const founderMatch = statement.match(/i\s+am\s+the\s+founder\s+of\s+(.+)/i);
    if (founderMatch?.[1]) {
      const role = normalizeSentence(founderMatch[1].replace(/[.!?]+$/, ""));
      if (role) {
        pushIf(asFact(`User is the founder of ${role}`, ["founder", "company"]));
      }
      continue;
    }

    const roleMatch = statement.match(/i\s+am\s+(?:also\s+)?(.+)/i);
    if (roleMatch?.[1]) {
      const role = normalizeSentence(roleMatch[1].replace(/[.!?]+$/, ""));
      if (role) {
        pushIf(asFact(`User is ${role}`, role.split(" ").slice(0, 3)));
      }
      continue;
    }

    const workMatch = statement.match(/i\s+(?:also\s+)?work\s+(.+)/i);
    if (workMatch?.[1]) {
      const work = normalizeSentence(workMatch[1].replace(/[.!?]+$/, ""));
      if (work) {
        pushIf(asFact(`User works ${work}`, ["work", "role"]));
      }
      continue;
    }

    const handleMatch = statement.match(/i\s+handle\s+(.+)/i);
    if (handleMatch?.[1]) {
      const responsibility = normalizeSentence(handleMatch[1].replace(/[.!?]+$/, ""));
      if (responsibility) {
        pushIf(asFact(`User handles ${responsibility}`, ["responsibility"]));
      }
      continue;
    }

    const preferenceMatch = statement.match(/(?:i\s+prefer|remember\s+that\s+i\s+prefer)\s+(.+)/i);
    if (preferenceMatch?.[1]) {
      const pref = normalizeSentence(preferenceMatch[1].replace(/[.!?]+$/, ""));
      if (pref) {
        results.push({
          category: "preference",
          content: `User prefers ${pref}`,
          conflictHints: [pref.split(" ")[0] ?? "preference"],
        });
      }
      continue;
    }

    const correctionMatch = statement.match(/(?:that's\s+wrong|not\s+true|correction:?|actually,)\s+(.+)/i);
    if (correctionMatch?.[1]) {
      const corrected = normalizeSentence(correctionMatch[1].replace(/[.!?]+$/, ""));
      if (corrected) {
        results.push({
          category: "correction",
          content: `User correction: ${corrected}`,
          conflictHints: ["correction"],
        });
      }
      continue;
    }

    const rememberMatch = statement.match(/(?:remember\s+that|don't\s+forget\s+that|dont\s+forget\s+that)\s+(.+)/i);
    if (rememberMatch?.[1]) {
      const remembered = normalizeSentence(rememberMatch[1].replace(/[.!?]+$/, ""));
      if (remembered) {
        pushIf(asFact(`User says: ${remembered}`, remembered.split(" ").slice(0, 2)));
      }
      continue;
    }
  }

  if (results.length > 0) {
    return results;
  }

  const generic = cleaned.match(/^(?:i\s|my\s|our\s)/i)
    ? asFact(`User says: ${cleaned}`, cleaned.split(" ").slice(0, 2))
    : null;

  return generic ? [generic] : [];
};
