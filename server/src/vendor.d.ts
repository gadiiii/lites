declare module 'midi' {
  class Input {
    getPortCount(): number;
    getPortName(index: number): string;
    openPort(index: number): void;
    closePort(): void;
    on(event: 'message', cb: (deltaTime: number, message: number[]) => void): void;
  }
  const _default: { Input: typeof Input };
  export default _default;
}
