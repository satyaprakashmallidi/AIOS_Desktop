import sys
import os
import argparse
from datetime import datetime

# Add current dir to path to import workspace
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    import workspace
except ImportError:
    # If called from root, try adding python/
    sys.path.append(os.path.join(os.getcwd(), "python"))
    import workspace

def main():
    parser = argparse.ArgumentParser(description="Save a new implementation plan in AIOS")
    parser.add_argument("--title", required=True, help="Title of the plan")
    parser.add_argument("--content", required=True, help="Full Markdown content of the plan")
    
    args = parser.parse_args()
    
    # Ensure workspace is initialized (sets env vars)
    if "AIOS_WORKSPACE_ROOT" not in os.environ:
        os.environ["AIOS_WORKSPACE_ROOT"] = workspace.get_workspace_root()

    # Generate filename: YYYY-MM-DD-slug.md
    today = datetime.now().strftime("%Y-%m-%d")
    slug = args.title.lower().strip().replace(" ", "-")
    # Clean slug
    slug = "".join(c for c in slug if c.isalnum() or c == "-")
    filename = f"{today}-{slug}.md"
    
    path = f"plans/{filename}"
    
    try:
        res = workspace.write_file(path, args.content)
        print(f"SUCCESS: Plan saved to {path} ({res['bytes']} bytes)")
    except Exception as e:
        print(f"ERROR: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
