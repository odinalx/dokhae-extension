import type { AccessReason } from './access';

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}

// Where "Add to flashcards" sends cards: the Dokhae website deck (default) or
// desktop Anki via AnkiConnect.
export type FlashcardTarget = 'site' | 'anki';

// Dokhae account + Naver Cloud credentials (Clova Voice) + Anki.
export interface Settings {
  // Dokhae website (subscription + built-in flashcards).
  siteToken: string;      // this device's token ("sori_…"); stored apart, see settings.ts
  flashcardTarget: FlashcardTarget;
  // Which Dokhae deck captured words land in. '' means "the account's first
  // deck" — the server's own fallback, so a fresh install needs no setup and a
  // deck deleted on the site doesn't strand the extension.
  soriDeckId: string;
  voiceApiKeyId: string;  // Clova Voice X-NCP-APIGW-API-KEY-ID
  voiceApiKey: string;    // Clova Voice X-NCP-APIGW-API-KEY
  voiceSpeaker: string;   // e.g. "nara"
  // Anki (via the AnkiConnect add-on running in desktop Anki).
  ankiConnectUrl: string; // e.g. "http://127.0.0.1:8765"
  ankiDeck: string;       // target deck name
  ankiAutoSend: boolean;  // push each card to Anki immediately instead of queueing
}

export const DEFAULT_SETTINGS: Settings = {
  siteToken: '',
  flashcardTarget: 'site',
  soriDeckId: '',
  voiceApiKeyId: '',
  voiceApiKey: '',
  voiceSpeaker: 'nara',
  ankiConnectUrl: 'http://127.0.0.1:8765',
  ankiDeck: 'Dokhae',
  ankiAutoSend: false,
};

// One Anki card waiting in the session queue (or being sent directly).
export interface AnkiCardDraft {
  id: string;                  // unique queue id
  word: string;                // Korean word as it appears in the sentence (surface)
  base?: string;               // normal/dictionary form used for the Vocab field
  wordTranslation: string;     // primary English meaning
  meanings: string[];          // additional meanings
  wordPos: string;             // part of speech (may be '')
  infinitive?: string;         // dictionary form for verbs/adjectives
  sentence: string;            // the scanned sentence (example)
  sentenceTranslation: string; // its translation
  source?: string;             // where the word was captured (page hostname)
  sourceUrl?: string;          // the page itself, linked from the site
  addedAt: number;             // timestamp
}

// Per-word analysis (translation + grammar).
export interface WordInfo {
  surface: string;       // the word as it appears in the text
  translation: string;   // primary English meaning
  meanings: string[];    // additional meanings (may be empty)
  pos: string;           // part of speech: 'noun' | 'verb' | 'adjective' | ... | ''
  infinitive?: string;   // Korean dictionary form for verbs/adjectives (e.g. 먹다)
  base?: string;         // normal form for ANY word (사과를→사과, 허락하다니→허락하다)
  form?: string;         // grammatical ending note (e.g. "-다니 — exclamatory (surprise)")
  speechLevel?: string;  // politeness/speech level (e.g. "casual (해체)")
}

export interface AnalysisResult {
  text: string;                 // recognized Korean text
  sentenceTranslation: string;  // whole-phrase translation
  tone: string;                 // heuristic politeness/tone of the phrase
  words: WordInfo[];
}

// content script -> background
export interface CaptureRequest {
  type: 'CAPTURE_REQUEST';
  rect: SelectionRect;
}

// background -> content script (response to CaptureRequest)
export interface CaptureResult {
  type: 'CAPTURE_RESULT';
  analysis: AnalysisResult;
}
export interface CaptureError {
  type: 'CAPTURE_ERROR';
  message: string;
  /** Set when the reader can fix it: the panel then offers the right button. */
  reason?: AccessReason;
}

// background -> content script (activate the drag overlay)
export interface ActivateScan {
  type: 'ACTIVATE_SCAN';
}

// popup -> background: inject the content script into this tab (activeTab)
// and open the scan overlay there.
export interface StartScan {
  type: 'START_SCAN';
  tabId: number;
}
// popup -> background: open the panel in this tab on the text selected
// there (read by the popup), the same path as the right-click entry.
// Answered with StartScanDone.
export interface AnalyzeSelectionInTab {
  type: 'ANALYZE_SELECTION_IN_TAB';
  tabId: number;
  text: string;
}
export interface StartScanDone {
  type: 'START_SCAN_DONE';
  ok: boolean;
  message?: string;
}

// background -> content script: is Dokhae already injected in this tab?
export interface Ping {
  type: 'PING';
}
export interface Pong {
  type: 'PONG';
}

// background -> content script (user picked "Analyze selection" from the
// right-click menu — open the panel and analyze this already-selected text)
export interface AnalyzeSelection {
  type: 'ANALYZE_SELECTION';
  text: string;
}

// content script -> background (run the text pipeline on raw Korean text,
// skipping capture/OCR). Responds with CaptureResult / CaptureError.
export interface AnalyzeTextRequest {
  type: 'ANALYZE_TEXT';
  text: string;
}

// background -> offscreen document (OCR)
export interface OcrRequest {
  type: 'OCR_REQUEST';
  target: 'offscreen';
  imageDataUrl: string;
}
export interface OcrResult {
  type: 'OCR_RESULT';
  text: string;
  /** Offsets in `text` of syllables read with low confidence (src/ocrText.ts). */
  uncertain: number[];
}
export interface OcrError {
  type: 'OCR_ERROR';
  message: string;
}

// content -> background -> offscreen: the scan overlay opened, so start the
// OCR engine now (worker, wasm core, Korean model) while the user frames a
// bubble, instead of after the capture.
export interface OcrWarm {
  type: 'OCR_WARM';
  target?: 'offscreen';
}

// offscreen -> all contexts (progress while OCR runs)
export interface OcrProgress {
  type: 'OCR_PROGRESS';
  status: string;
  progress: number; // 0..1
}

// content script -> background (request spoken audio for some Korean text)
export interface TtsRequest {
  type: 'TTS_REQUEST';
  text: string;
}
export interface TtsDone {
  type: 'TTS_DONE';
  ok: boolean;
  message?: string;
}

// background -> offscreen document (play fetched audio)
export interface TtsPlay {
  type: 'TTS_PLAY';
  target: 'offscreen';
  audioDataUrl: string;
}

// popup/options -> background: is the extension unlocked (valid token on the
// Dokhae website), and on which plan? `force` bypasses the cached check.
export interface AccessCheckRequest {
  type: 'ACCESS_CHECK';
  force?: boolean;
}
export interface AccessInfo {
  type: 'ACCESS_INFO';
  ok: boolean;
  reason?: AccessReason;
  email?: string;
  plan?: string;
  subscribed?: boolean;
  revokedReason?: string; // with 'invalid-token': why the site disconnected this browser
  siteUrl: string; // site origin, for "open the website" links
}

// content -> background: queue a card (sends straight to the website/Anki when
// the destination is the site or Anki auto-send is on)
export interface AnkiAddRequest {
  type: 'ANKI_ADD';
  card: Omit<AnkiCardDraft, 'id' | 'addedAt'>;
}
export interface AnkiAddDone {
  type: 'ANKI_ADD_DONE';
  ok: boolean;
  queued: number;   // queue size after the operation
  sentNow: boolean; // true if it went straight to the destination
  target: FlashcardTarget;
  message?: string;
  reason?: AccessReason;
}

// content/popup -> background: flush the whole queue to the destination
export interface AnkiSendAllRequest {
  type: 'ANKI_SEND_ALL';
}
export interface AnkiSendAllDone {
  type: 'ANKI_SEND_ALL_DONE';
  ok: boolean;
  added: number;
  failed: number;
  dropped?: number;  // failures removed from the queue (the site rejected the card)
  remaining: number; // cards still queued (the failures)
  target: FlashcardTarget;
  message?: string;
}

// content/popup -> background: read the queue state
export interface AnkiQueueQuery {
  type: 'ANKI_QUEUE';
}
export interface AnkiQueueInfo {
  type: 'ANKI_QUEUE_INFO';
  count: number;
  autoSend: boolean;
  target: FlashcardTarget;
}

// content/popup -> background: empty the queue
export interface AnkiClearRequest {
  type: 'ANKI_CLEAR';
}
export interface AnkiClearDone {
  type: 'ANKI_CLEAR_DONE';
  ok: boolean;
}

// connect content script -> background: the site's /connect-extension page
// handed over a token. The background verifies it, then stores it.
export interface ConnectToken {
  type: 'CONNECT_TOKEN';
  token: string;
}
export interface ConnectDone {
  type: 'CONNECT_DONE';
  ok: boolean;
  email?: string;
  subscribed?: boolean;
  error?: import('./connect').ConnectErrorCode;
}

export type ExtensionMessage =
  | AccessCheckRequest
  | ConnectToken
  | ConnectDone
  | AccessInfo
  | ActivateScan
  | StartScan
  | AnalyzeSelectionInTab
  | StartScanDone
  | Ping
  | Pong
  | AnalyzeSelection
  | AnalyzeTextRequest
  | CaptureRequest
  | CaptureResult
  | CaptureError
  | OcrRequest
  | OcrResult
  | OcrError
  | OcrProgress
  | OcrWarm
  | TtsRequest
  | TtsDone
  | TtsPlay
  | AnkiAddRequest
  | AnkiAddDone
  | AnkiSendAllRequest
  | AnkiSendAllDone
  | AnkiQueueQuery
  | AnkiQueueInfo
  | AnkiClearRequest
  | AnkiClearDone;
