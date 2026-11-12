/** stdout carries the picture, so anything the app logs goes to stderr, which the launcher points at a log file. */
console.log = console.error;
console.info = console.error;
console.debug = console.error;
