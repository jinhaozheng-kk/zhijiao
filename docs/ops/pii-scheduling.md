# PII GC Scheduling

Run `pii:gc-sweep` outside the web process. The command is idempotent and can be
run more often than the retention thresholds.

## Recommended Frequency

- Short bucket: daily.
- Medium bucket: weekly.
- Orphan top-up bucket: monthly.
- Simple mode: run `--bucket all` daily.

## Windows Task Scheduler

Program:

```powershell
pwsh.exe
```

Arguments:

```powershell
-NoProfile -Command "Set-Location D:\智教; pnpm.cmd --filter @zhijiao/web pii:gc-sweep --bucket all"
```

Suggested schedule: daily at 03:00 local time.

## Kubernetes CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: zhijiao-pii-gc-sweep
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      backoffLimit: 3
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: sweep
              image: zhijiao-web:latest
              command: ["pnpm", "--filter", "@zhijiao/web", "pii:gc-sweep", "--bucket", "all"]
```

## Dry Run

Use this before first production run:

```powershell
pnpm.cmd --filter @zhijiao/web pii:gc-sweep --bucket all --dry-run
```
