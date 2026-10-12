import React from 'react';
import { Image, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/hooks/use-theme';
import { imageUri, type ImageBlock } from '@/lib/images';

/** A photo in a note: tap for the whole thing. */
export function Photo({ block }: { block: ImageBlock }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = React.useState(false);
  const uri = imageUri(block);
  // Tall photos are cropped to a reasonable height in the timeline.
  const ratio = Math.max(block.width / Math.max(block.height, 1), 0.75);

  if (!uri) {
    return (
      <View className="rounded-sm px-3.5 py-3 flex-row items-center" style={{ backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border }}>
        <Icon name="image" size={16} color={colors.fgTertiary} />
        <Text className="font-sans text-sm ml-2" style={{ color: colors.fgTertiary }}>
          Photo not on this phone
        </Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel={block.caption || 'Photo. Open it.'}
        className="rounded-sm overflow-hidden active:opacity-90"
        style={{ borderWidth: 1, borderColor: colors.border }}
      >
        <Image source={{ uri }} style={{ width: '100%', aspectRatio: ratio }} resizeMode="cover" />
      </Pressable>
      {block.caption ? (
        <Text className="font-sans text-sm -mt-1" style={{ color: colors.fgSecondary }}>
          {block.caption}
        </Text>
      ) : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' }}
        >
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          <View style={{ position: 'absolute', top: insets.top + 12, right: 16 }}>
            <Icon name="x" size={24} color="#FFFFFF" />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
