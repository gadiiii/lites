/** Common interface for all DMX output drivers */
export interface DMXOutput {
  open(): Promise<void>;
  /** Send a 512-byte universe buffer to the physical output */
  send(universe: Uint8Array): void;
  close(): void;
}
