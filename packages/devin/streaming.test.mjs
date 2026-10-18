// Devin sends a tool call's arguments whole and its text in long runs; the
// plugin passes them on in pieces, so a client draws them as they come
// (magpie-community/plugins#224, pi's codemode painting its script at once).
import { expect, test } from "bun:test"
import { _internal } from "./index.mjs"

const { PB, events, pieces, PIECE } = _internal

// reply is Devin's stream: one frame of text, reasoning and a tool call.
const reply = (text, reasoning, args) => {
  const msg = new PB()
    .str(9, reasoning)
    .str(3, text)
    .bytes(6, new PB().str(1, "toolu_1").str(2, "codemode").str(3, args))
    .varint(5, 10)
    .done()
  const frames = [{ end: false, data: msg }, { end: true, data: new TextEncoder().encode("{}") }]
  return { next: async () => (frames.length ? { done: false, value: frames.shift() } : { done: true }) }
}

const collect = async (it) => {
  const out = []
  for await (const e of events(it)) out.push(e)
  return out
}

test("a long tool call's arguments go out in pieces that join to the whole", async () => {
  const args = JSON.stringify({ code: "/*\n" + "hello ".repeat(80) + "*/\nawait tools.bash({ command: 'echo done' })" })
  const out = await collect(reply("", "", args))
  const got = out.filter((e) => e.args)
  expect(got.length).toBe(Math.ceil(args.length / PIECE))
  expect(got.every((e) => e.args.index === 0 && e.args.text.length <= PIECE)).toBe(true)
  expect(got.map((e) => e.args.text).join("")).toBe(args)
  expect(out.findIndex((e) => e.tool)).toBeLessThan(out.findIndex((e) => e.args))
  expect(out.at(-1).stop).toBe("tool_calls")
})

test("long text and reasoning go out in pieces too", async () => {
  const text = "word ".repeat(50)
  const reasoning = "think ".repeat(40)
  const out = await collect(reply(text, reasoning, "{}"))
  const texts = out.filter((e) => e.text).map((e) => e.text)
  const thoughts = out.filter((e) => e.reasoning).map((e) => e.reasoning)
  expect(texts.length).toBeGreaterThan(1)
  expect(thoughts.length).toBeGreaterThan(1)
  expect(texts.join("")).toBe(text)
  expect(thoughts.join("")).toBe(reasoning)
})

test("a piece never ends on half of a surrogate pair", () => {
  const s = "a".repeat(PIECE - 1) + "😀".repeat(20)
  const got = [...pieces(s)]
  expect(got.join("")).toBe(s)
  for (const p of got) {
    expect(p.length).toBeLessThanOrEqual(PIECE)
    expect((p.charCodeAt(p.length - 1) & 0xfc00) === 0xd800).toBe(false)
    expect((p.charCodeAt(0) & 0xfc00) === 0xdc00).toBe(false)
  }
})

test("short text stays one piece", () => {
  expect([...pieces("hi")]).toEqual(["hi"])
  expect([...pieces("")]).toEqual([])
})
