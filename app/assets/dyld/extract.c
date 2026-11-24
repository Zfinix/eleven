#include <dlfcn.h>
#include <stdio.h>

typedef int (*extract_fn)(const char *cache, const char *out, void (^progress)(unsigned current, unsigned total));

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: extract <dyld_shared_cache> <folder>\n");
    return 2;
  }
  void *bundle = dlopen("/usr/lib/dsc_extractor.bundle", RTLD_NOW);
  if (!bundle) {
    fprintf(stderr, "macOS's dsc_extractor.bundle couldn't be loaded: %s\n", dlerror());
    return 1;
  }
  extract_fn extract = (extract_fn)dlsym(bundle, "dyld_shared_cache_extract_dylibs_progress");
  if (!extract) {
    fprintf(stderr, "dsc_extractor.bundle has no dyld_shared_cache_extract_dylibs_progress\n");
    return 1;
  }
  int result = extract(argv[1], argv[2], ^(unsigned current, unsigned total) {
    printf("%u %u\n", current, total);
    fflush(stdout);
  });
  if (result != 0) fprintf(stderr, "dsc_extractor stopped with code %d\n", result);
  return result;
}
