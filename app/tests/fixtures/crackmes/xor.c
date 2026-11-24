#include <stdio.h>
#include <string.h>

static const unsigned char hidden[] = {0x32, 0x35, 0x2a, 0x2a, 0x3f, 0x28, 0x6b, 0x6b};

int main(int argc, char **argv) {
  if (argc != 2 || strlen(argv[1]) != sizeof hidden) {
    puts("Wrong");
    return 1;
  }
  for (size_t i = 0; i < sizeof hidden; i++) {
    if (((unsigned char)argv[1][i] ^ 0x5a) != hidden[i]) {
      puts("Wrong");
      return 1;
    }
  }
  puts("Correct");
  return 0;
}
