# Example Collectors

These are reference implementations for common data sources.
During installation, Claude reads these as patterns and either:

1. **Copies them directly** to `scripts/collect_NAME.py` if they match your source
2. **Adapts them** for your specific setup (different columns, custom metrics)
3. **Builds new ones** from scratch for sources not listed here, using the same pattern

## Available Examples

| File | Source | API Key Needed | What It Collects |
|------|--------|---------------|------------------|
| `youtube.py` | YouTube Data API v3 | Yes (free) | Channel stats, video performance |
| `stripe.py` | Stripe API | Yes (free) | Revenue, MRR, subscriptions, churn |
| `google_analytics.py` | GA4 Data API | Service account | Website traffic, sources |
| `google_sheets.py` | Google Sheets API | Service account | Any spreadsheet data |
| `bitly.py` | Bitly API v4 | Yes (free) | Link clicks, content attribution |

## The Collector Pattern

Every collector exports three things:

```python
def collect():
    """Pull data from the API. Returns {source, status, data}."""
    ...

def write(conn, result, date):
    """Write to database. Creates tables if needed. Returns record count."""
    ...

if __name__ == "__main__":
    """Quick test — run the collector standalone."""
    ...
```

The orchestrator (`collect.py`) auto-discovers any `collect_*.py` file in the
scripts directory and runs it. To add a new source, just create a new file
following this pattern.
