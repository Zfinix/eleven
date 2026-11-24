function makeCounter(start) {
  let count = start;
  return function next() { count += 1; return count; };
}
function checkPin(pin) {
  const secret = "4821";
  if (pin.length !== 4) return "too short";
  return pin === secret ? "unlocked" : "wrong pin";
}
var counter = makeCounter(10);
print(counter(), checkPin("4821"));
