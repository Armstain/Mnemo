# expo-task-manager re-creates a task's consumer by class name after a restart (Class.forName,
# then its (Context, TaskManagerUtilsInterface) constructor). Release builds shrink and rename
# classes, so without this, place reminders would stop after a reboot in release builds only.
# expo-location keeps its own consumers the same way.
-keep class expo.modules.mnemoreliability.MnemoGeofencingConsumer { *; }
