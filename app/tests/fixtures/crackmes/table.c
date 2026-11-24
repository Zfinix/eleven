#include <stdio.h>
#include <string.h>

static const char pool[] = "qzrkatemovbnxl";
static const int order[] = {3, 11, 1, 4, 13, 6, 0, 9};

static void build(char *out) {
  for (size_t i = 0; i < sizeof order / sizeof order[0]; i++) out[i] = pool[order[i]] ^ 0x20;
  out[sizeof order / sizeof order[0]] = 0;
}

int main(int argc, char **argv) {
  char key[16];
  build(key);
  if (argc == 2 && strcmp(argv[1], key) == 0) {
    puts("Correct");
    return 0;
  }
  puts("Wrong");
  return 1;
}
