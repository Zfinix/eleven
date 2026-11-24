#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
  char key[9];
  key[3] = 'r';
  key[0] = 'g';
  key[6] = 'u';
  key[1] = 'h';
  key[7] = 'x';
  key[4] = 'a';
  key[2] = 'i';
  key[5] = 'p';
  key[8] = 0;
  if (argc == 2 && strcmp(argv[1], key) == 0) {
    puts("Correct");
    return 0;
  }
  puts("Wrong");
  return 1;
}
