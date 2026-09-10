#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

/*
 * Own one dedicated Claude CLI and its OS descendants, including tools that
 * call setsid(). No Task state, protocol parsing, process-name matching or
 * shared-daemon discovery belongs here. Kernel child custody is the authority.
 * Keep this supervisor alive until waitpid proves every adopted child exited.
 */
static volatile sig_atomic_t stopping = 0;

static void request_stop(int signal_number) {
  stopping = signal_number;
}

static long long monotonic_ms(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) < 0) {
    perror("Claude owner clock");
    exit(125);
  }
  return (long long)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

static int signal_children(int signal_number) {
  char path[96];
  snprintf(path, sizeof(path), "/proc/self/task/%ld/children", (long)getpid());
  FILE *children = fopen(path, "r");
  if (children == NULL) return -1;
  long pid;
  int result = 0;
  while (fscanf(children, "%ld", &pid) == 1) {
    /*
     * Only our unreaped direct children are listed. This process is the sole
     * waiter, so their PIDs cannot be reused between this read and kill().
     * Killing a parent causes its remaining children to be adopted here.
     */
    if (pid > 0 && kill((pid_t)pid, signal_number) < 0 && errno != ESRCH) result = -1;
  }
  if (ferror(children)) result = -1;
  fclose(children);
  return result;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fputs("Usage: claude-process-owner <executable> [arguments...]\n", stderr);
    return 125;
  }
  struct sigaction action = {0};
  action.sa_handler = request_stop;
  sigemptyset(&action.sa_mask);
  if (sigaction(SIGTERM, &action, NULL) < 0
      || sigaction(SIGINT, &action, NULL) < 0
      || sigaction(SIGHUP, &action, NULL) < 0
      || prctl(PR_SET_CHILD_SUBREAPER, 1L, 0L, 0L, 0L) < 0) {
    perror("Claude process ownership");
    return 125;
  }
  pid_t parent = getppid();
  if (prctl(PR_SET_PDEATHSIG, (long)SIGTERM, 0L, 0L, 0L) < 0) {
    perror("Claude parent-death signal");
    return 125;
  }
  if (parent == 1 || getppid() != parent) return 125;
  pid_t root = fork();
  if (root < 0) {
    perror("Claude owner fork");
    return 125;
  }
  if (root == 0) {
    signal(SIGTERM, SIG_DFL);
    signal(SIGINT, SIG_DFL);
    signal(SIGHUP, SIG_DFL);
    execvp(argv[1], &argv[1]);
    perror("Claude executable");
    _exit(127);
  }
  bool root_ended = false, warned = false;
  int root_status = 0;
  long long stop_started = 0;
  for (;;) {
    bool draining = stopping != 0 || root_ended;
    if (draining) {
      if (stop_started == 0) stop_started = monotonic_ms();
      int signal_number = monotonic_ms() - stop_started < 1000 ? SIGTERM : SIGKILL;
      if (signal_children(signal_number) < 0 && !warned) {
        fputs("Claude descendant cleanup is unconfirmed; retaining process ownership.\n", stderr);
        warned = true;
      }
    }
    int status;
    pid_t child = waitpid(-1, &status, draining ? WNOHANG : 0);
    if (child > 0) {
      if (child == root) {
        root_ended = true;
        root_status = status;
      }
      continue;
    }
    if (child < 0) {
      if (errno == EINTR) continue;
      if (errno == ECHILD) break;
      perror("Claude owner wait");
      return 125;
    }
    const struct timespec pause = { .tv_sec = 0, .tv_nsec = 20000000 };
    nanosleep(&pause, NULL);
  }
  if (!root_ended) return 125;
  return WIFEXITED(root_status) ? WEXITSTATUS(root_status)
    : WIFSIGNALED(root_status) ? 128 + WTERMSIG(root_status) : 125;
}
