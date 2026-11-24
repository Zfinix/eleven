#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  if (strcmp(argv[1], "eleven-2026") == 0) {
    puts("Correct");
    return 0;
  }
  puts("Wrong");
  return 1;
}
