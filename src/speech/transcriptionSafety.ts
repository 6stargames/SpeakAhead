const CONTEXT_LABEL = /(?:aac\s+transcription\s+context\s+only|on[\s\u2010-\u2015-]*device\s+draft|recent\s+aac\s+conversation)\b/i;

function comparableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
}

/**
 * Reject a transcription that copied the private accuracy hints instead of
 * transcribing the supplied audio. A rejected result leaves the ONNX draft in
 * place, which is safer than showing prior conversation as newly spoken text.
 */
export function isTranscriptionContextLeak(
  transcript: string,
  recentContext = '',
  onDeviceDraft = '',
): boolean {
  if (CONTEXT_LABEL.test(transcript)) return true;

  const candidate = comparableText(transcript);
  const context = comparableText(recentContext);
  const draft = comparableText(onDeviceDraft);

  // A current utterance can coincidentally repeat a short phrase. Requiring a
  // substantial, exact context match avoids rejecting ordinary repetition.
  if (context.length >= 32 && candidate.includes(context)) return true;

  // Catch a label-free copy of both hints even when the model changes their
  // order or inserts punctuation between them.
  return context.length >= 16 && draft.length >= 8 &&
    candidate.includes(context) && candidate.includes(draft);
}
