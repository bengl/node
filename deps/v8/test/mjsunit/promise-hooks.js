// Copyright 2020 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// Flags: --allow-natives-syntax --opt --no-always-opt --no-stress-opt --deopt-every-n-times=0 --ignore-unhandled-promises

let log = [];

let asyncId = 0;
function logEvent (type, args) {
  const promise = args[0];
  promise.asyncId = promise.asyncId || ++asyncId;
  log.push({
    type,
    promise,
    parent: args[1],
    argsLength: args.length
  })
}

function initHook (...args) {
  logEvent('init', args);
}
function resolveHook(...args) {
  logEvent('resolve', args);
}
function beforeHook(...args) {
  logEvent('before', args);
}
function afterHook(...args) {
  logEvent('after', args);
}
function reset () {
  console.log('--- resetting... ---')
  for (const event of log) {
    validateLogEvent(event);
  }
  log = [];
}

function validateLogEvent (event) {
  console.log(JSON.stringify(event));
  if (event.type === 'init') {
    assertEquals(event.argsLength, 2);
    assertTrue(event.parent instanceof Promise || typeof event.parent === 'undefined');
  } else {
    assertEquals(event.argsLength, 1);
  }
  assertTrue(event.promise instanceof Promise);
}

// Log search helpers
function byType(type) {
  return log.filter(event => event.type === type);
}
function lastByType(type) {
  return byType(type).pop();
}
function lastPromise(type) {
  return lastByType(type)?.promise;
}
function lastParent() {
  return lastByType('init')?.parent;
}
function countByType(type) {
  return byType(type).length;
}

function basicTest() {
  d8.promise.setHooks(initHook, beforeHook, afterHook, resolveHook);

  // `new Promise(...)` triggers init event with correct promise
  var done, p1 = new Promise(r => done = r);

  %PerformMicrotaskCheckpoint();

  assertEquals(1, countByType('init'));
  assertEquals(0, countByType('before'));
  assertEquals(0, countByType('after'));
  assertEquals(0, countByType('resolve'));

  assertEquals(lastPromise('init'), p1);
  assertEquals(lastPromise('before'), undefined);
  assertEquals(lastPromise('after'), undefined);
  assertEquals(lastPromise('resolve'), undefined);
  assertEquals(lastParent(), undefined);

  reset();

  // `promise.then(...)` triggers init event with correct promise and parent
  var p2 = p1.then(() => { });

  %PerformMicrotaskCheckpoint();

  assertEquals(1, countByType('init'));
  assertEquals(0, countByType('before'));
  assertEquals(0, countByType('after'));
  assertEquals(0, countByType('resolve'));

  assertEquals(lastPromise('init'), p2);
  assertEquals(lastPromise('before'), undefined);
  assertEquals(lastPromise('after'), undefined);
  assertEquals(lastPromise('resolve'), undefined);
  assertEquals(lastParent(), p1);

  reset();

  // `resolve(...)` triggers resolve event and any already attached continuations
  done();

  %PerformMicrotaskCheckpoint();

  assertEquals(0, countByType('init'));
  assertEquals(1, countByType('before'));
  assertEquals(1, countByType('after'));
  assertEquals(2, countByType('resolve'));

  assertEquals(lastPromise('init'), undefined);
  assertEquals(lastPromise('before'), p2);
  assertEquals(lastPromise('after'), p2);
  assertEquals(lastPromise('resolve'), p2);
  assertEquals(lastParent(), undefined);

  reset();

  // `reject(...)` triggers the resolve event
  var done, p3 = new Promise((_, r) => done = r);
  reset();
  done();

  %PerformMicrotaskCheckpoint();

  assertEquals(0, countByType('init'));
  assertEquals(0, countByType('before'));
  assertEquals(0, countByType('after'));
  assertEquals(1, countByType('resolve'));

  assertEquals(lastPromise('init'), undefined);
  assertEquals(lastPromise('before'), undefined);
  assertEquals(lastPromise('after'), undefined);
  assertEquals(lastPromise('resolve'), p3);
  assertEquals(lastParent(), undefined);

  reset();

  // `promise.catch(...)` triggers init event with correct promise and parent
  // When the promise is already completed, the continuation should also run
  // immediately at the next checkpoint.
  var p4 = p3.catch(() => { });

  %PerformMicrotaskCheckpoint();

  assertEquals(1, countByType('init'));
  assertEquals(1, countByType('before'));
  assertEquals(1, countByType('after'));
  assertEquals(1, countByType('resolve'));

  assertEquals(lastPromise('init'), p4);
  assertEquals(lastPromise('before'), p4);
  assertEquals(lastPromise('after'), p4);
  assertEquals(lastPromise('resolve'), p4);
  assertEquals(lastParent(), p3);

  reset();
}

function exceptions () {
  function reset () {
    %PerformMicrotaskCheckpoint();
    d8.promise.setHooks();
  }

  function thrower () {
    throw new Error('unexpected!');
  }

  // Throwing in an init hook should not raise or reject the promise
  d8.promise.setHooks(
    thrower
  );

  assertDoesNotThrow(() => {
    Promise.resolve()
      .catch(assertUnreachable);
  });
  reset();

  // Throwing in a before hook should not raise or reject the promise
  d8.promise.setHooks(
    undefined,
    thrower
  );

  assertDoesNotThrow(() => {
    Promise.resolve()
      .then(() => { })
      .catch(assertUnreachable);
  });
  reset();

  // Throwing in an after hook should not raise or reject the promise
  d8.promise.setHooks(
    undefined,
    undefined,
    thrower
  );

  assertDoesNotThrow(() => {
    Promise.resolve()
      .then(() => { })
      .catch(assertUnreachable);
  });
  reset();

  // Throwing in a resolve hook should not raise or reject the promise
  d8.promise.setHooks(
    undefined,
    undefined,
    undefined,
    thrower
  );

  assertDoesNotThrow(() => {
    Promise.resolve()
      .catch(assertUnreachable);
  });
  reset();
}

async function test() {
  await Promise.resolve();
}

function optimizerBailout () {
  %PerformMicrotaskCheckpoint();

  // Warm up test method
  %PrepareFunctionForOptimization(test);
  assertUnoptimized(test);
  test();
  test();
  test();

  %PerformMicrotaskCheckpoint();

  %OptimizeFunctionOnNextCall(test);
  test();
  assertOptimized(test);
  %PerformMicrotaskCheckpoint();

  // Verify
  d8.promise.setHooks(initHook, beforeHook, afterHook, resolveHook);
  assertUnoptimized(test);

  %PrepareFunctionForOptimization(test);
  test();
  %PerformMicrotaskCheckpoint();

  assertEquals(3, countByType('init'));
  assertEquals(1, countByType('before'));
  assertEquals(1, countByType('after'));
  assertEquals(3, countByType('resolve'));

  reset();

  %OptimizeFunctionOnNextCall(test);
  test();
  assertOptimized(test);
  %PerformMicrotaskCheckpoint();

  assertEquals(3, countByType('init'));
  assertEquals(1, countByType('before'));
  assertEquals(1, countByType('after'));
  assertEquals(3, countByType('resolve'));

  reset();

  // Setting JS promise hooks should deopt the function
  d8.promise.setHooks(initHook, beforeHook, afterHook, resolveHook);

  test();
  %PerformMicrotaskCheckpoint();

  assertEquals(3, countByType('init'));
  assertEquals(1, countByType('before'));
  assertEquals(1, countByType('after'));
  assertEquals(3, countByType('resolve'));

  reset();
}

optimizerBailout();
basicTest();
exceptions();
