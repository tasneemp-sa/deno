// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
  deferred,
  delay,
  execCode,
} from "./test_util.ts";
import { join } from "../../../test_util/std/path/mod.ts";

let isCI: boolean;
try {
  isCI = Deno.env.get("CI") !== undefined;
} catch {
  isCI = true;
}

Deno.test({ permissions: { net: true } }, function netTcpListenClose() {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 3500 });
  assert(listener.addr.transport === "tcp");
  assertEquals(listener.addr.hostname, "127.0.0.1");
  assertEquals(listener.addr.port, 3500);
  assertNotEquals(listener.rid, 0);
  listener.close();
});

Deno.test(
  {
    permissions: { net: true },
  },
  function netUdpListenClose() {
    const socket = Deno.listenDatagram({
      hostname: "127.0.0.1",
      port: 3500,
      transport: "udp",
    });
    assert(socket.addr.transport === "udp");
    assertEquals(socket.addr.hostname, "127.0.0.1");
    assertEquals(socket.addr.port, 3500);
    socket.close();
  },
);

function tmpUnixSocketPath(): string {
  const folder = Deno.makeTempDirSync();
  return join(folder, "socket");
}

Deno.test(
  {
    ignore: Deno.build.os === "windows",
    permissions: { read: true, write: true },
  },
  function netUnixListenClose() {
    const filePath = tmpUnixSocketPath();
    const socket = Deno.listen({
      path: filePath,
      transport: "unix",
    });
    assert(socket.addr.transport === "unix");
    assertEquals(socket.addr.path, filePath);
    socket.close();
  },
);

Deno.test(
  {
    ignore: Deno.build.os === "windows",
    permissions: { read: true, write: true },
  },
  function netUnixPacketListenClose() {
    const filePath = tmpUnixSocketPath();
    const socket = Deno.listenDatagram({
      path: filePath,
      transport: "unixpacket",
    });
    assert(socket.addr.transport === "unixpacket");
    assertEquals(socket.addr.path, filePath);
    socket.close();
  },
);

Deno.test(
  {
    ignore: Deno.build.os === "windows",
    permissions: { read: true, write: false },
  },
  function netUnixListenWritePermission() {
    assertThrows(() => {
      const filePath = tmpUnixSocketPath();
      const socket = Deno.listen({
        path: filePath,
        transport: "unix",
      });
      assert(socket.addr.transport === "unix");
      assertEquals(socket.addr.path, filePath);
      socket.close();
    }, Deno.errors.PermissionDenied);
  },
);

Deno.test(
  {
    ignore: Deno.build.os === "windows",
    permissions: { read: true, write: false },
  },
  function netUnixPacketListenWritePermission() {
    assertThrows(() => {
      const filePath = tmpUnixSocketPath();
      const socket = Deno.listenDatagram({
        path: filePath,
        transport: "unixpacket",
      });
      assert(socket.addr.transport === "unixpacket");
      assertEquals(socket.addr.path, filePath);
      socket.close();
    }, Deno.errors.PermissionDenied);
  },
);

Deno.test(
  {
    permissions: { net: true },
  },
  async function netTcpCloseWhileAccept() {
    const listener = Deno.listen({ port: 4501 });
    const p = listener.accept();
    listener.close();
    // TODO(piscisaureus): the error type should be `Interrupted` here, which
    // gets thrown, but then ext/net catches it and rethrows `BadResource`.
    await assertRejects(
      () => p,
      Deno.errors.BadResource,
      "Listener has been closed",
    );
  },
);

Deno.test(
  {
    ignore: Deno.build.os === "windows",
    permissions: { read: true, write: true },
  },
  async function netUnixCloseWhileAccept() {
    const filePath = tmpUnixSocketPath();
    const listener = Deno.listen({
      path: filePath,
      transport: "unix",
    });
    const p = listener.accept();
    listener.close();
    await assertRejects(
      () => p,
      Deno.errors.BadResource,
      "Listener has been closed",
    );
  },
);

Deno.test(
  { permissions: { net: true } },
  async function netTcpConcurrentAccept() {
    const listener = Deno.listen({ port: 4510 });
    let acceptErrCount = 0;
    const checkErr = (e: Error) => {
      if (e.message === "Listener has been closed") {
        assertEquals(acceptErrCount, 1);
      } else if (e.message === "Another accept task is ongoing") {
        acceptErrCount++;
      } else {
        throw new Error("Unexpected error message");
      }
    };
    const p = listener.accept().catch(checkErr);
    const p1 = listener.accept().catch(checkErr);
    await Promise.race([p, p1]);
    listener.close();
    await Promise.all([p, p1]);
    assertEquals(acceptErrCount, 1);
  },
);

Deno.test(
  {
    ignore: Deno.build.os === "windows",
    permissions: { read: true, write: true },
  },
  async function netUnixConcurrentAccept() {
    const filePath = tmpUnixSocketPath();
    const listener = Deno.listen({ transport: "unix", path: filePath });
    let acceptErrCount = 0;
    const checkErr = (e: Error) => {
      if (e.message === "Listener has been closed") {
        assertEquals(acceptErrCount, 1);
      } else if (e instanceof Deno.errors.Busy) { // "Listener already in use"
        acceptErrCount++;
      } else {
        throw e;
      }
    };
    const p = listener.accept().catch(checkErr);
    const p1 = listener.accept().catch(checkErr);
    await Promise.race([p, p1]);
    listener.close();
    await Promise.all([p, p1]);
    assertEquals(acceptErrCount, 1);
  },
);

Deno.test({ permissions: { net: true } }, async function netTcpDialListen() {
  const listener = Deno.listen({ port: 3500 });
  listener.accept().then(
    async (conn) => {
      assert(conn.remoteAddr != null);
      assert(conn.localAddr.transport === "tcp");
      assertEquals(conn.localAddr.hostname, "127.0.0.1");
      assertEquals(conn.localAddr.port, 3500);
      await conn.write(new Uint8Array([1, 2, 3]));
      conn.close();
    },
  );

  const conn = await Deno.connect({ hostname: "127.0.0.1", port: 3500 });
  assert(conn.remoteAddr.transport === "tcp");
  assertEquals(conn.remoteAddr.hostname, "127.0.0.1");
  assertEquals(conn.remoteAddr.port, 3500);
  assert(conn.localAddr != null);
  const buf = new Uint8Array(1024);
  const readResult = await conn.read(buf);
  assertEquals(3, readResult);
  assertEquals(1, buf[0]);
  assertEquals(2, buf[1]);
  assertEquals(3, buf[2]);
  assert(conn.rid > 0);

  assert(readResult !== null);

  const readResult2 = await conn.read(buf);
  assertEquals(readResult2, null);

  listener.close();
  conn.close();
});

Deno.test({ permissions: { net: true } }, async function netTcpSetNoDelay() {
  const listener = Deno.listen({ port: 3500 });
  listener.accept().then(
    async (conn) => {
      assert(conn.remoteAddr != null);
      assert(conn.localAddr.transport === "tcp");
      assertEquals(conn.localAddr.hostname, "127.0.0.1");
      assertEquals(conn.localAddr.port, 3500);
      await conn.write(new Uint8Array([1, 2, 3]));
      conn.close();
    },
  );

  const conn = await Deno.connect({ hostname: "127.0.0.1", port: 3500 });
  conn.setNoDelay(true);
  assert(conn.remoteAddr.transport === "tcp");
  assertEquals(conn.remoteAddr.hostname, "127.0.0.1");
  assertEquals(conn.remoteAddr.port, 3500);
  assert(conn.localAddr != null);
  const buf = new Uint8Array(1024);
  const readResult = await conn.read(buf);
  assertEquals(3, readResult);
  assertEquals(1, buf[0]);
  assertEquals(2, buf[1]);
  assertEquals(3, buf[2]);
  assert(conn.rid > 0);

  assert(readResult !== null);

  const readResult2 = await conn.read(buf);
  assertEquals(readResult2, null);

  listener.close();
  conn.close();
});

Deno.test({ permissions: { net: true } }, async function netTcpSetKeepAlive() {
  const listener = Deno.listen({ port: 3500 });
  listener.accept().then(
    async (conn) => {
      assert(conn.remoteAddr != null);
      assert(conn.localAddr.transport === "tcp");
      assertEquals(conn.localAddr.hostname, "127.0.0.1");
      assertEquals(conn.localAddr.port, 3500);
      await conn.write(new Uint8Array([1, 2, 3]));
      conn.close();
    },
  );

  const conn = await Deno.connect({ hostname: "127.0.0.1", port: 3500 });
  conn.setKeepAlive(true);
  assert(conn.remoteAddr.transport === "tcp");
  assertEquals(conn.remoteAddr.hostname, "127.0.0.1");
  assertEquals(conn.remoteAddr.port, 3500);
  assert(conn.localAddr != null);
  const buf = new Uint8Array(1024);
  const readResult = await conn.read(buf);
  assertEquals(3, readResult);
  assertEquals(1, buf[0]);
  assertEquals(2, buf[1]);
  assertEquals(3, buf[2]);
  assert(conn.rid > 0);

  assert(readResult !== null);

  const readResult2 = await conn.read(buf);
  assertEquals(readResult2, null);

  listener.close();
  conn.close();
});

Deno.test(
  {
    ignore: Deno.build.os === "windows",
    permissions: { read: true, write: true },
  },
  async function netUnixDialListen() {
    const filePath = tmpUnixSocketPath();
    const listener = Deno.listen({ path: filePath, transport: "unix" });
    listener.accept().then(
      async (conn) => {
        assert(conn.remoteAddr != null);
        assert(conn.localAddr.transport === "unix");
        assertEquals(conn.localAddr.path, filePath);
        await conn.write(new Uint8Array([1, 2, 3]));
        conn.close();
      },
    );
    const conn = await Deno.connect({ path: filePath, transport: "unix" });
    assert(conn.remoteAddr.transport === "unix");
    assertEquals(conn.remoteAddr.path, filePath);
    assert(conn.remoteAddr != null);
    const buf = new Uint8Array(1024);
    const readResult = await conn.read(buf);
    assertEquals(3, readResult);
    assertEquals(1, buf[0]);
    assertEquals(2, buf[1]);
    assertEquals(3, buf[2]);
    assert(conn.rid > 0);

    assert(readResult !== null);

    const readResult2 = await conn.read(buf);
    assertEquals(readResult2, null);

    listener.close();
    conn.close();
  },
);

Deno.test(
  { permissions: { net: true } },
  async function netUdpSendReceive() {
    const alice = Deno.listenDatagram({ port: 3500, transport: "udp" });
    assert(alice.addr.transport === "udp");
    assertEquals(alice.addr.port, 3500);
    assertEquals(alice.addr.hostname, "127.0.0.1");

    const bob = Deno.listenDatagram({ port: 4501, transport: "udp" });
    assert(bob.addr.transport === "udp");
    assertEquals(bob.addr.port, 4501);
    assertEquals(bob.addr.hostname, "127.0.0.1");

    const sent = new Uint8Array([1, 2, 3]);
    const byteLength = await alice.send(sent, bob.addr);

    assertEquals(byteLength, 3);

    const [recvd, remote] = await bob.receive();
    assert(remote.transport === "udp");
    assertEquals(remote.port, 3500);
    assertEquals(recvd.length, 3);
    assertEquals(1, recvd[0]);
    assertEquals(2, recvd[1]);
    assertEquals(3, recvd[2]);
    alice.close();
    bob.close();
  },
);

Deno.test(
  { permissions: { net: true }, ignore: true },
  async function netUdpSendReceiveBroadcast() {
    // Must bind sender to an address that can send to the broadcast address on MacOS.
    // Macos will give us error 49 when sending the broadcast packet if we omit hostname here.
    const alice = Deno.listenDatagram({
      port: 3500,
      transport: "udp",
      hostname: "0.0.0.0",
    });

    const bob = Deno.listenDatagram({
      port: 4501,
      transport: "udp",
      hostname: "0.0.0.0",
    });
    assert(bob.addr.transport === "udp");
    assertEquals(bob.addr.port, 4501);
    assertEquals(bob.addr.hostname, "0.0.0.0");

    const broadcastAddr = { ...bob.addr, hostname: "255.255.255.255" };

    const sent = new Uint8Array([1, 2, 3]);
    const byteLength = await alice.send(sent, broadcastAddr);

    assertEquals(byteLength, 3);
    const [recvd, remote] = await bob.receive();
    assert(remote.transport === "udp");
    assertEquals(remote.port, 3500);
    assertEquals(recvd.length, 3);
    assertEquals(1, recvd[0]);
    assertEquals(2, recvd[1]);
    assertEquals(3, recvd[2]);
    alice.close();
    bob.close();
  },
);

Deno.test(
  { permissions: { net: true } },
  async function netUdpConcurrentSendReceive() {
    const socket = Deno.listenDatagram({ port: 3500, transport: "udp" });
    assert(socket.addr.transport === "udp");
    assertEquals(socket.addr.port, 3500);
    assertEquals(socket.addr.hostname, "127.0.0.1");

    const recvPromise = socket.receive();

    const sendBuf = new Uint8Array([1, 2, 3]);
    const sendLen = await socket.send(sendBuf, socket.addr);
    assertEquals(sendLen, 3);

    const [recvBuf, _recvAddr] = await recvPromise;
    assertEquals(recvBuf.length, 3);
    assertEquals(1, recvBuf[0]);
    assertEquals(2, recvBuf[1]);
    assertEquals(3, recvBuf[2]);

    socket.close();
  },
);

Deno.test(
  { permissions: { net: true } },
  async function netUdpBorrowMutError() {
    const socket = Deno.listenDatagram({
      port: 4501,
      transport: "udp",
    });
    // Panic happened on second send: BorrowMutError
    const a = socket.send(new Uint8Array(), socket.addr);
    const b = socket.send(new Uint8Array(), socket.addr);
    await Promise.all([a, b]);
    socket.close();
  },
);

Deno.test(
  {
    ignore: Deno.build.os === "windows",
    permissions: { read: true, write: true },
  },
  async function netUnixPacketSendReceive() {
    const aliceFilePath = tmpUnixSocketPath();
    const alice = Deno.listenDatagram({
      path: aliceFilePath,
      transport: "unixpacket",
    });
    assert(alice.addr.transport === "unixpacket");
    assertEquals(alice.addr.path, aliceFilePath);

    const bobFilePath = tmpUnixSocketPath();
    const bob = Deno.listenDatagram({
      path: bobFilePath,
      transport: "unixpacket",
    });
    assert(bob.addr.transport === "unixpacket");
    assertEquals(bob.addr.path, bobFilePath);

    const sent = new Uint8Array([1, 2, 3]);
    const byteLength = await alice.send(sent, bob.addr);
    assertEquals(byteLength, 3);

    const [recvd, remote] = await bob.receive();
    assert(remote.transport === "unixpacket");
    assertEquals(remote.path, aliceFilePath);
    assertEquals(recvd.length, 3);
    assertEquals(1, recvd[0]);
    assertEquals(2, recvd[1]);
    assertEquals(3, recvd[2]);
    alice.close();
    bob.close();
  },
);

// TODO(lucacasonato): support concurrent reads and writes on unixpacket sockets
Deno.test(
  { ignore: true, permissions: { read: true, write: true } },
  async function netUnixPacketConcurrentSendReceive() {
    const filePath = tmpUnixSocketPath();
    const socket = Deno.listenDatagram({
      path: filePath,
      transport: "unixpacket",
    });
    assert(socket.addr.transport === "unixpacket");
    assertEquals(socket.addr.path, filePath);

    const recvPromise = socket.receive();

    const sendBuf = new Uint8Array([1, 2, 3]);
    const sendLen = await socket.send(sendBuf, socket.addr);
    assertEquals(sendLen, 3);

    const [recvBuf, _recvAddr] = await recvPromise;
    assertEquals(recvBuf.length, 3);
    assertEquals(1, recvBuf[0]);
    assertEquals(2, recvBuf[1]);
    assertEquals(3, recvBuf[2]);

    socket.close();
  },
);

Deno.test(
  { permissions: { net: true } },
  async function netTcpListenIteratorBreakClosesResource() {
    async function iterate(listener: Deno.Listener) {
      let i = 0;

      for await (const conn of listener) {
        conn.close();
        i++;

        if (i > 1) {
          break;
        }
      }
    }

    const addr = { hostname: "127.0.0.1", port: 8888 };
    const listener = Deno.listen(addr);
    const iteratePromise = iterate(listener);

    await delay(100);
    const conn1 = await Deno.connect(addr);
    conn1.close();
    const conn2 = await Deno.connect(addr);
    conn2.close();

    await iteratePromise;
  },
);

Deno.test(
  { permissions: { net: true } },
  async function netTcpListenCloseWhileIterating() {
    const listener = Deno.listen({ port: 8001 });
    const nextWhileClosing = listener[Symbol.asyncIterator]().next();
    listener.close();
    assertEquals(await nextWhileClosing, { value: undefined, done: true });

    const nextAfterClosing = listener[Symbol.asyncIterator]().next();
    assertEquals(await nextAfterClosing, { value: undefined, done: true });
  },
);

Deno.test(
  { permissions: { net: true } },
  async function netUdpListenCloseWhileIterating() {
    const socket = Deno.listenDatagram({ port: 8000, transport: "udp" });
    const nextWhileClosing = socket[Symbol.asyncIterator]().next();
    socket.close();
    assertEquals(await nextWhileClosing, { value: undefined, done: true });

    const nextAfterClosing = socket[Symbol.asyncIterator]().next();
    assertEquals(await nextAfterClosing, { value: undefined, done: true });
  },
);

Deno.test(
  {
    ignore: Deno.build.os === "windows",
    permissions: { read: true, write: true },
  },
  async function netUnixListenCloseWhileIterating() {
    const filePath = tmpUnixSocketPath();
    const socket = Deno.listen({ path: filePath, transport: "unix" });
    const nextWhileClosing = socket[Symbol.asyncIterator]().next();
    socket.close();
    assertEquals(await nextWhileClosing, { value: undefined, done: true });

    const nextAfterClosing = socket[Symbol.asyncIterator]().next();
    assertEquals(await nextAfterClosing, { value: undefined, done: true });
  },
);

Deno.test(
  {
    ignore: Deno.build.os === "windows",
    permissions: { read: true, write: true },
  },
  async function netUnixPacketListenCloseWhileIterating() {
    const filePath = tmpUnixSocketPath();
    const socket = Deno.listenDatagram({
      path: filePath,
      transport: "unixpacket",
    });
    const nextWhileClosing = socket[Symbol.asyncIterator]().next();
    socket.close();
    assertEquals(await nextWhileClosing, { value: undefined, done: true });

    const nextAfterClosing = socket[Symbol.asyncIterator]().next();
    assertEquals(await nextAfterClosing, { value: undefined, done: true });
  },
);

Deno.test(
  { permissions: { net: true } },
  async function netListenAsyncIterator() {
    const addr = { hostname: "127.0.0.1", port: 3500 };
    const listener = Deno.listen(addr);
    const runAsyncIterator = async () => {
      for await (const conn of listener) {
        await conn.write(new Uint8Array([1, 2, 3]));
        conn.close();
      }
    };
    runAsyncIterator();
    const conn = await Deno.connect(addr);
    const buf = new Uint8Array(1024);
    const readResult = await conn.read(buf);
    assertEquals(3, readResult);
    assertEquals(1, buf[0]);
    assertEquals(2, buf[1]);
    assertEquals(3, buf[2]);
    assert(conn.rid > 0);

    assert(readResult !== null);

    const readResult2 = await conn.read(buf);
    assertEquals(readResult2, null);

    listener.close();
    conn.close();
  },
);

Deno.test(
  {
    permissions: { net: true },
  },
  async function netCloseWriteSuccess() {
    const addr = { hostname: "127.0.0.1", port: 3500 };
    const listener = Deno.listen(addr);
    const closeDeferred = deferred();
    listener.accept().then(async (conn) => {
      await conn.write(new Uint8Array([1, 2, 3]));
      await closeDeferred;
      conn.close();
    });
    const conn = await Deno.connect(addr);
    conn.closeWrite(); // closing write
    const buf = new Uint8Array(1024);
    // Check read not impacted
    const readResult = await conn.read(buf);
    assertEquals(3, readResult);
    assertEquals(1, buf[0]);
    assertEquals(2, buf[1]);
    assertEquals(3, buf[2]);
    // Verify that the write end of the socket is closed.
    // TODO(piscisaureus): assert that thrown error is of a specific type.
    await assertRejects(async () => {
      await conn.write(new Uint8Array([1, 2, 3]));
    });
    closeDeferred.resolve();
    listener.close();
    conn.close();
  },
);

Deno.test(
  {
    // https://github.com/denoland/deno/issues/11580
    ignore: Deno.build.os === "darwin" && isCI,
    permissions: { net: true },
  },
  async function netHangsOnClose() {
    let acceptedConn: Deno.Conn;

    async function iteratorReq(listener: Deno.Listener) {
      const p = new Uint8Array(10);
      const conn = await listener.accept();
      acceptedConn = conn;

      try {
        while (true) {
          const nread = await conn.read(p);
          if (nread === null) {
            break;
          }
          await conn.write(new Uint8Array([1, 2, 3]));
        }
      } catch (err) {
        assert(err);
        assert(err instanceof Deno.errors.Interrupted);
      }
    }

    const addr = { hostname: "127.0.0.1", port: 3500 };
    const listener = Deno.listen(addr);
    const listenerPromise = iteratorReq(listener);
    const connectionPromise = (async () => {
      const conn = await Deno.connect(addr);
      await conn.write(new Uint8Array([1, 2, 3, 4]));
      const buf = new Uint8Array(10);
      await conn.read(buf);
      conn!.close();
      acceptedConn!.close();
      listener.close();
    })();

    await Promise.all([
      listenerPromise,
      connectionPromise,
    ]);
  },
);

Deno.test(
  {
    permissions: { net: true },
  },
  function netExplicitUndefinedHostname() {
    const listener = Deno.listen({ hostname: undefined, port: 8080 });
    assertEquals((listener.addr as Deno.NetAddr).hostname, "0.0.0.0");
    listener.close();
  },
);

Deno.test(
  {
    ignore: Deno.build.os !== "linux",
    permissions: { read: true, write: true },
  },
  function netUnixAbstractPathShouldNotPanic() {
    const listener = Deno.listen({
      path: "\0aaa",
      transport: "unix",
    });
    assert("not panic");
    listener.close();
  },
);

Deno.test({ permissions: { net: true } }, async function whatwgStreams() {
  (async () => {
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 3500 });
    const conn = await listener.accept();
    await conn.readable.pipeTo(conn.writable);
    listener.close();
  })();

  const conn = await Deno.connect({ hostname: "127.0.0.1", port: 3500 });
  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const data = encoder.encode("Hello World");

  await writer.write(data);
  const { value, done } = await reader.read();
  assert(!done);
  assertEquals(decoder.decode(value), "Hello World");
  await reader.cancel();
});

Deno.test(
  { permissions: { read: true } },
  async function readableStreamTextEncoderPipe() {
    const filename = "cli/tests/testdata/assets/hello.txt";
    const file = await Deno.open(filename);
    const readable = file.readable.pipeThrough(new TextDecoderStream());
    const chunks = [];
    for await (const chunk of readable) {
      chunks.push(chunk);
    }
    assertEquals(chunks.length, 1);
    assertEquals(chunks[0].length, 12);
  },
);

Deno.test(
  { permissions: { read: true, write: true } },
  async function writableStream() {
    const path = await Deno.makeTempFile();
    const file = await Deno.open(path, { write: true });
    assert(file.writable instanceof WritableStream);
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello "));
        controller.enqueue(new TextEncoder().encode("world!"));
        controller.close();
      },
    });
    await readable.pipeTo(file.writable);
    const res = await Deno.readTextFile(path);
    assertEquals(res, "hello world!");
  },
);

Deno.test(
  { permissions: { read: true, run: true } },
  async function netListenUnref() {
    const [statusCode, _output] = await execCode(`
      async function main() {
        const listener = Deno.listen({ port: 3500 });
        listener.unref();
        await listener.accept(); // This doesn't block the program from exiting
      }
      main();
    `);
    assertEquals(statusCode, 0);
  },
);

Deno.test(
  { permissions: { read: true, run: true } },
  async function netListenUnref() {
    const [statusCode, _output] = await execCode(`
      async function main() {
        const listener = Deno.listen({ port: 3500 });
        await listener.accept();
        listener.unref();
        await listener.accept(); // The program exits here
        throw new Error(); // The program doesn't reach here
      }
      main();
      const conn = await Deno.connect({ port: 3500 });
      conn.close();
    `);
    assertEquals(statusCode, 0);
  },
);

Deno.test(
  { permissions: { read: true, run: true, net: true } },
  async function netListenUnrefAndRef() {
    const p = execCode(`
      async function main() {
        const listener = Deno.listen({ port: 3500 });
        listener.unref();
        listener.ref(); // This restores 'ref' state of listener
        await listener.accept();
        console.log("accepted")
      }
      main();
    `);
    // TODO(kt3k): This is racy. Find a correct way to
    // wait for the server to be ready
    setTimeout(async () => {
      const conn = await Deno.connect({ port: 3500 });
      conn.close();
    }, 200);
    const [statusCode, output] = await p;
    assertEquals(statusCode, 0);
    assertEquals(output.trim(), "accepted");
  },
);

Deno.test(
  { permissions: { net: true } },
  async function netListenUnrefConcurrentAccept() {
    const timer = setTimeout(() => {}, 1000);
    const listener = Deno.listen({ port: 3500 });
    listener.accept().catch(() => {});
    listener.unref();
    // Unref'd listener still causes Busy error
    // on concurrent accept calls.
    await assertRejects(async () => {
      await listener.accept(); // The program exits here
    }, Deno.errors.Busy);
    listener.close();
    clearTimeout(timer);
  },
);

Deno.test({
  ignore: Deno.build.os === "windows",
  permissions: { read: true, write: true },
}, function netUnixListenAddrAlreadyInUse() {
  const filePath = tmpUnixSocketPath();
  const listener = Deno.listen({ path: filePath, transport: "unix" });
  assertThrows(
    () => {
      Deno.listen({ path: filePath, transport: "unix" });
    },
    Deno.errors.AddrInUse,
  );
  listener.close();
});

Deno.test({ permissions: { net: true } }, async function netTcpReuseAddr() {
  const listener1 = Deno.listen({
    hostname: "127.0.0.1",
    port: 3500,
  });
  listener1.accept().then(
    (conn) => {
      conn.close();
    },
  );

  const conn1 = await Deno.connect({ hostname: "127.0.0.1", port: 3500 });
  const buf1 = new Uint8Array(1024);
  await conn1.read(buf1);
  listener1.close();
  conn1.close();

  const listener2 = Deno.listen({
    hostname: "127.0.0.1",
    port: 3500,
  });

  listener2.accept().then(
    (conn) => {
      conn.close();
    },
  );

  const conn2 = await Deno.connect({ hostname: "127.0.0.1", port: 3500 });
  const buf2 = new Uint8Array(1024);
  await conn2.read(buf2);

  listener2.close();
  conn2.close();
});

Deno.test(
  { permissions: { net: true } },
  async function netUdpReuseAddr() {
    const sender = Deno.listenDatagram({
      port: 4002,
      transport: "udp",
    });
    const listener1 = Deno.listenDatagram({
      port: 4000,
      transport: "udp",
      reuseAddress: true,
    });
    const listener2 = Deno.listenDatagram({
      port: 4000,
      transport: "udp",
      reuseAddress: true,
    });

    const sent = new Uint8Array([1, 2, 3]);
    await sender.send(sent, listener1.addr);
    await Promise.any([listener1.receive(), listener2.receive()]).then(
      ([recvd, remote]) => {
        assert(remote.transport === "udp");
        assertEquals(recvd.length, 3);
        assertEquals(1, recvd[0]);
        assertEquals(2, recvd[1]);
        assertEquals(3, recvd[2]);
      },
    );
    sender.close();
    listener1.close();
    listener2.close();
  },
);

Deno.test(
  { permissions: { net: true } },
  function netUdpNoReuseAddr() {
    let listener1;
    try {
      listener1 = Deno.listenDatagram({
        port: 4001,
        transport: "udp",
        reuseAddress: false,
      });
    } catch (err) {
      assert(err);
      assert(err instanceof Deno.errors.AddrInUse); // AddrInUse from previous test
    }

    assertThrows(() => {
      Deno.listenDatagram({
        port: 4001,
        transport: "udp",
        reuseAddress: false,
      });
    }, Deno.errors.AddrInUse);
    if (typeof listener1 !== "undefined") {
      listener1.close();
    }
  },
);

Deno.test({
  ignore: Deno.build.os !== "linux",
  permissions: { net: true },
}, async function netTcpListenReusePort() {
  const port = 4003;
  const listener1 = Deno.listen({ port, reusePort: true });
  const listener2 = Deno.listen({ port, reusePort: true });
  let p1;
  let p2;
  let listener1Recv = false;
  let listener2Recv = false;
  while (!listener1Recv || !listener2Recv) {
    if (!p1) {
      p1 = listener1.accept().then((conn) => {
        conn.close();
        listener1Recv = true;
        p1 = undefined;
      }).catch(() => {});
    }
    if (!p2) {
      p2 = listener2.accept().then((conn) => {
        conn.close();
        listener2Recv = true;
        p2 = undefined;
      }).catch(() => {});
    }
    const conn = await Deno.connect({ port });
    conn.close();
    await Promise.race([p1, p2]);
  }
  listener1.close();
  listener2.close();
});

Deno.test({
  ignore: Deno.build.os === "linux",
  permissions: { net: true },
}, function netTcpListenReusePortDoesNothing() {
  const listener1 = Deno.listen({ port: 4003, reusePort: true });
  assertThrows(() => {
    Deno.listen({ port: 4003, reusePort: true });
  }, Deno.errors.AddrInUse);
  listener1.close();
});
