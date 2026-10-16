// Web NFC isn't in TypeScript's DOM types (it only ships in Chrome on Android). SPEC §10.5.
interface NDEFRecord {
  readonly recordType: string;
  readonly data?: DataView;
}

interface NDEFReadingEvent extends Event {
  readonly serialNumber: string;
  readonly message: { readonly records: readonly NDEFRecord[] };
}

interface NDEFReader extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(
    message: string | { records: Array<{ recordType: string; data: string }> },
    options?: { overwrite?: boolean; signal?: AbortSignal },
  ): Promise<void>;
}

// Optional on purpose: `window.NDEFReader` is the feature test (absent everywhere but Android Chrome).
interface Window {
  NDEFReader?: new () => NDEFReader;
}
