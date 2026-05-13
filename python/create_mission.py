import sys
import os
import argparse
from uuid import uuid4

# Add current dir to path to import workspace and tasks_store
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    import workspace
    import tasks_store
except ImportError:
    # If called from root, try adding python/
    sys.path.append(os.path.join(os.getcwd(), "python"))
    import workspace
    import tasks_store

def main():
    parser = argparse.ArgumentParser(description="Create a new mission in AIOS")
    parser.add_argument("--name", required=True, help="Short name for the mission")
    parser.add_argument("--message", required=True, help="Detailed description of the mission")
    parser.add_argument("--agent", default="ceo", help="Agent ID to assign (default: ceo)")
    parser.add_argument("--priority", type=int, default=3, help="Priority 1-5 (default: 3)")
    
    args = parser.parse_args()
    
    # Ensure workspace is initialized (sets env vars)
    if "AIOS_WORKSPACE_ROOT" not in os.environ:
        os.environ["AIOS_WORKSPACE_ROOT"] = workspace.get_workspace_root()

    try:
        task = tasks_store.create_task(
            name=args.name,
            message=args.message,
            agent_id=args.agent,
            priority=args.priority
        )
        print(f"SUCCESS: Mission created with ID {task['id']}")
        print(f"Assigned to: {args.agent}")
    except Exception as e:
        print(f"ERROR: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
