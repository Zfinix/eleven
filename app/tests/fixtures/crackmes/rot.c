#include <stdio.h>
#include <string.h>

static const char stored[] = "frgnetrgav";

static char rot13(char c) {
  if (c >= 'a' && c <= 'z') return (char)('a' + (c - 'a' + 13) % 26);
  return c;
}

int main(int argc, char **argv) {
  size_t n = sizeof stored - 1;
  if (argc != 2 || strlen(argv[1]) != n) {
    puts("Wrong");
    return 1;
  }
  for (size_t i = 0; i < n; i++) {
    if (rot13(argv[1][n - 1 - i]) != stored[i]) {
      puts("Wrong");
      return 1;
    }
  }
  puts("Correct");
  return 0;
}
