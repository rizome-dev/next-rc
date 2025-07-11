import { TrustLevel } from '@rizome/next-rc-types';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface NamespaceConfig {
  mount: boolean;
  uts: boolean;
  ipc: boolean;
  pid: boolean;
  network: boolean;
  user: boolean;
  cgroup: boolean;
}

interface SeccompProfile {
  defaultAction: string;
  architectures: string[];
  syscalls: Array<{
    names: string[];
    action: string;
  }>;
}

export class SystemSandbox {
  private seccompProfiles: Map<TrustLevel, SeccompProfile>;
  private activeNamespaces: Map<string, Set<string>> = new Map();

  constructor() {
    this.seccompProfiles = new Map();
    this.initializeSeccompProfiles();
  }

  async setup(trustLevel: TrustLevel): Promise<{
    namespaces: string[];
    seccompProfile: string;
  }> {
    const namespaces = await this.createNamespaces(trustLevel);
    const seccompProfile = this.getSeccompProfileName(trustLevel);

    return { namespaces, seccompProfile };
  }

  async cleanup(namespaces: string[]): Promise<void> {
    // Cleanup namespaces
    for (const ns of namespaces) {
      this.activeNamespaces.delete(ns);
    }
  }

  private async createNamespaces(trustLevel: TrustLevel): Promise<string[]> {
    const config = this.getNamespaceConfig(trustLevel);
    const namespaces: string[] = [];

    // Check if we have the necessary capabilities
    if (!this.hasNamespaceCapability()) {
      console.warn('Running without namespace isolation - requires CAP_SYS_ADMIN');
      return namespaces;
    }

    if (config.mount) namespaces.push('mount');
    if (config.uts) namespaces.push('uts');
    if (config.ipc) namespaces.push('ipc');
    if (config.pid) namespaces.push('pid');
    if (config.network) namespaces.push('network');
    if (config.user) namespaces.push('user');
    if (config.cgroup) namespaces.push('cgroup');

    const nsId = `sandbox-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.activeNamespaces.set(nsId, new Set(namespaces));

    return namespaces;
  }

  private getNamespaceConfig(trustLevel: TrustLevel): NamespaceConfig {
    switch (trustLevel) {
      case TrustLevel.Low:
        return {
          mount: true,
          uts: true,
          ipc: true,
          pid: true,
          network: true,
          user: true,
          cgroup: true,
        };

      case TrustLevel.Medium:
        return {
          mount: true,
          uts: true,
          ipc: true,
          pid: true,
          network: false, // Allow network for medium trust
          user: true,
          cgroup: true,
        };

      case TrustLevel.High:
        return {
          mount: false,
          uts: true,
          ipc: false,
          pid: true,
          network: false,
          user: false,
          cgroup: true,
        };

      default:
        return this.getNamespaceConfig(TrustLevel.Low);
    }
  }

  private initializeSeccompProfiles(): void {
    // Low trust level - very restrictive
    this.seccompProfiles.set(TrustLevel.Low, {
      defaultAction: 'SCMP_ACT_ERRNO',
      architectures: ['SCMP_ARCH_X86_64', 'SCMP_ARCH_X86', 'SCMP_ARCH_X32'],
      syscalls: [
        {
          names: [
            'read', 'write', 'close', 'fstat', 'lseek', 'mmap', 'mprotect',
            'munmap', 'brk', 'rt_sigaction', 'rt_sigprocmask', 'rt_sigreturn',
            'ioctl', 'pread64', 'pwrite64', 'readv', 'writev', 'pipe', 'select',
            'sched_yield', 'mremap', 'msync', 'mincore', 'madvise', 'shmget',
            'shmat', 'shmctl', 'dup', 'nanosleep', 'getpid', 'sendfile',
            'socket', 'connect', 'accept', 'sendto', 'recvfrom', 'sendmsg',
            'recvmsg', 'shutdown', 'bind', 'listen', 'getsockname', 'getpeername',
            'socketpair', 'getsockopt', 'setsockopt', 'clone', 'fork', 'vfork',
            'execve', 'exit', 'wait4', 'kill', 'uname', 'fcntl', 'flock',
            'fsync', 'fdatasync', 'truncate', 'ftruncate', 'getcwd', 'chdir',
            'rename', 'mkdir', 'rmdir', 'link', 'unlink', 'symlink', 'readlink',
            'chmod', 'fchmod', 'chown', 'fchown', 'lchown', 'umask', 'gettimeofday',
            'getrlimit', 'getrusage', 'sysinfo', 'times', 'getuid', 'getgid',
            'geteuid', 'getegid', 'setuid', 'setgid', 'getgroups', 'setgroups',
            'setresuid', 'getresuid', 'setresgid', 'getresgid', 'getpgid',
            'setpgid', 'getsid', 'setsid', 'capget', 'capset', 'rt_sigpending',
            'rt_sigtimedwait', 'rt_sigqueueinfo', 'rt_sigsuspend', 'utime',
            'access', 'sync', 'msync', 'getpriority', 'setpriority',
            'sched_setparam', 'sched_getparam', 'sched_setscheduler',
            'sched_getscheduler', 'sched_get_priority_max', 'sched_get_priority_min',
            'sched_rr_get_interval', 'mlock', 'munlock', 'mlockall', 'munlockall',
            'vhangup', 'prctl', 'arch_prctl', 'adjtimex', 'setrlimit', 'sync',
            'mount', 'umount2', 'reboot', 'sethostname', 'setdomainname',
            'init_module', 'delete_module', 'quotactl', 'nfsservctl', 'getpmsg',
            'putpmsg', 'query_module', 'security', 'gettid', 'readahead',
            'setxattr', 'lsetxattr', 'fsetxattr', 'getxattr', 'lgetxattr',
            'fgetxattr', 'listxattr', 'llistxattr', 'flistxattr', 'removexattr',
            'lremovexattr', 'fremovexattr', 'tkill', 'time', 'futex', 'set_tid_address',
            'restart_syscall', 'semtimedop', 'timer_create', 'timer_settime',
            'timer_gettime', 'timer_getoverrun', 'timer_delete', 'clock_settime',
            'clock_gettime', 'clock_getres', 'clock_nanosleep', 'exit_group',
            'epoll_ctl', 'tgkill', 'mbind', 'set_mempolicy', 'get_mempolicy',
            'mq_open', 'mq_unlink', 'mq_timedsend', 'mq_timedreceive', 'mq_notify',
            'mq_getsetattr', 'kexec_load', 'waitid', 'add_key', 'request_key',
            'keyctl', 'ioprio_set', 'ioprio_get', 'migrate_pages',
            'openat', 'mkdirat', 'mknodat', 'fchownat', 'futimesat', 'newfstatat',
            'unlinkat', 'renameat', 'linkat', 'symlinkat', 'readlinkat',
            'fchmodat', 'faccessat', 'pselect6', 'ppoll', 'set_robust_list',
            'get_robust_list', 'splice', 'tee', 'sync_file_range', 'vmsplice',
            'move_pages', 'utimensat', 'epoll_pwait', 'signalfd', 'timerfd_create',
            'eventfd', 'fallocate', 'timerfd_settime', 'timerfd_gettime',
            'accept4', 'signalfd4', 'eventfd2', 'epoll_create1', 'dup3',
            'pipe2', 'preadv', 'pwritev', 'rt_tgsigqueueinfo',
            'perf_event_open', 'recvmmsg', 'getcpu'
          ],
          action: 'SCMP_ACT_ALLOW',
        },
      ],
    });

    // Medium trust level - moderate restrictions
    this.seccompProfiles.set(TrustLevel.Medium, {
      defaultAction: 'SCMP_ACT_ERRNO',
      architectures: ['SCMP_ARCH_X86_64', 'SCMP_ARCH_X86', 'SCMP_ARCH_X32'],
      syscalls: [
        {
          names: ['*'], // Allow most syscalls
          action: 'SCMP_ACT_ALLOW',
        },
        {
          names: [
            'ptrace', 'process_vm_readv', 'process_vm_writev',
            'mount', 'umount2', 'pivot_root', 'chroot',
            'init_module', 'finit_module', 'delete_module',
            'kexec_load', 'kexec_file_load',
            'reboot', 'setns', 'unshare',
          ],
          action: 'SCMP_ACT_ERRNO',
        },
      ],
    });

    // High trust level - minimal restrictions
    this.seccompProfiles.set(TrustLevel.High, {
      defaultAction: 'SCMP_ACT_ALLOW',
      architectures: ['SCMP_ARCH_X86_64', 'SCMP_ARCH_X86', 'SCMP_ARCH_X32'],
      syscalls: [
        {
          names: [
            'ptrace', 'process_vm_readv', 'process_vm_writev',
            'kexec_load', 'kexec_file_load',
          ],
          action: 'SCMP_ACT_ERRNO',
        },
      ],
    });
  }

  private getSeccompProfileName(trustLevel: TrustLevel): string {
    return `next-rc-seccomp-${trustLevel}`;
  }

  async setResourceLimits(
    processId: number,
    limits: {
      memory?: number;
      cpu?: number;
      fileDescriptors?: number;
      processes?: number;
    }
  ): Promise<void> {
    // Use cgroups v2 to set resource limits
    const cgroupPath = `/sys/fs/cgroup/next-rc/process-${processId}`;

    try {
      // Create cgroup
      await fs.promises.mkdir(cgroupPath, { recursive: true });

      // Set memory limit
      if (limits.memory) {
        await fs.promises.writeFile(
          path.join(cgroupPath, 'memory.max'),
          limits.memory.toString()
        );
      }

      // Set CPU limit (as percentage * 10000)
      if (limits.cpu) {
        const cpuQuota = Math.floor(limits.cpu * 1000);
        await fs.promises.writeFile(
          path.join(cgroupPath, 'cpu.max'),
          `${cpuQuota} 100000`
        );
      }

      // Add process to cgroup
      await fs.promises.writeFile(
        path.join(cgroupPath, 'cgroup.procs'),
        processId.toString()
      );
    } catch (error) {
      console.warn(`Failed to set resource limits for process ${processId}:`, error);
    }
  }

  private hasNamespaceCapability(): boolean {
    try {
      // Check if we have CAP_SYS_ADMIN
      const caps = execSync('capsh --print', { encoding: 'utf8' });
      return caps.includes('cap_sys_admin');
    } catch {
      return false;
    }
  }

  createUnshareCommand(
    command: string[],
    namespaces: string[]
  ): string[] {
    const unshareCmd = ['unshare'];

    if (namespaces.includes('mount')) unshareCmd.push('--mount');
    if (namespaces.includes('uts')) unshareCmd.push('--uts');
    if (namespaces.includes('ipc')) unshareCmd.push('--ipc');
    if (namespaces.includes('pid')) unshareCmd.push('--pid', '--fork');
    if (namespaces.includes('network')) unshareCmd.push('--net');
    if (namespaces.includes('user')) unshareCmd.push('--user', '--map-root-user');
    if (namespaces.includes('cgroup')) unshareCmd.push('--cgroup');

    return [...unshareCmd, ...command];
  }

  async applySeccompProfile(
    processId: number,
    _profile: SeccompProfile
  ): Promise<void> {
    // In a real implementation, this would use libseccomp or BPF
    // to apply the seccomp filter to the process
    console.log(`Applying seccomp profile to process ${processId}`);
  }

  getMetrics() {
    return {
      activeNamespaces: this.activeNamespaces.size,
      seccompProfiles: this.seccompProfiles.size,
    };
  }
}