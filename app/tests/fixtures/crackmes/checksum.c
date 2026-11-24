#include <stdio.h>
#include <string.h>

static int valid(const char *serial) {
  if (strlen(serial) != 8 || serial[0] != 'E' || serial[4] != '-') return 0;
  unsigned sum = 0;
  for (int i = 0; i < 8; i++) {
    if (i == 4) continue;
    if (serial[i] < '0' || serial[i] > 'Z') return 0;
    sum += (unsigned char)serial[i] * (unsigned)(i + 1);
  }
  return sum % 97 == 11;
}

int main(int argc, char **argv) {
  if (argc == 2 && valid(argv[1])) {
    puts("Correct");
    return 0;
  }
  puts("Wrong");
  return 1;
}
