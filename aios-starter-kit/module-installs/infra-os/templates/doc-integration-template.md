# Integration: [Name]

> One-line description of what this integration connects to.

## Overview

What external service it connects to, what data it collects, how often it runs.

## Key Files

| File | Purpose |
|------|---------|
| `path/to/collector` | Collects data from the API |
| `path/to/writer` | Writes data to the database |

## Data Tables

| Table | Key Columns | Description |
|-------|-------------|-------------|
| `example_daily` | date, metric_name, value | Daily snapshots |

## How It Works

1. Authentication method (API key, OAuth, etc.)
2. What data is fetched
3. How it's transformed
4. Where it's stored

## Key Queries

```sql
-- Most useful query for this data
SELECT * FROM example_daily
WHERE date >= date('now', '-30 days')
ORDER BY date DESC;
```

## Configuration

| Variable | Purpose | Where to get it |
|----------|---------|-----------------|
| `SERVICE_API_KEY` | API authentication | https://example.com/settings/api |

## Gotchas

- Known issue 1 and how to handle it
- Edge case to watch for
- Rate limits or quota considerations

## History

| Date | Change |
|------|--------|
| YYYY-MM-DD | Initial documentation |
