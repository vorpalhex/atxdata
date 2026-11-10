// A native assertion against Bun's best-effort console path, not an fd stub.
console.error = () => {
  throw new Error("unchecked stderr writer");
};
