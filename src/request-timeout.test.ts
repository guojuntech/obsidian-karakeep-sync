import { requestUrl } from "obsidian";
import { requestWithTimeout } from "./request-timeout";

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());

test("hung network requests time out and late results do not resume the caller", async () => {
  let resolve!: (response: any) => void;
  (requestUrl as jest.Mock).mockImplementation(() => new Promise(r => { resolve = r; }));
  const write = jest.fn();
  const pending = requestWithTimeout({url: "https://example.com"}, 1000).then(write);
  const failed = expect(pending).rejects.toThrow("timed out");
  await jest.advanceTimersByTimeAsync(1000);
  await failed;
  resolve({status: 200});
  await Promise.resolve();
  expect(write).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test("successful requests clear their timeout", async () => {
  const response = {status: 200};
  (requestUrl as jest.Mock).mockResolvedValue(response);
  expect(await requestWithTimeout({url: "https://example.com"})).toBe(response);
  expect(jest.getTimerCount()).toBe(0);
});
