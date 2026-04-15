import React from 'react';
import { View, TextInput, Pressable } from 'react-native';
import { Search, X } from 'lucide-react-native';

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onClear?: () => void;
  placeholder?: string;
  className?: string;
}

export const SearchBar = ({
  value,
  onChangeText,
  onClear,
  placeholder = 'Search your thoughts...',
  className = '',
}: SearchBarProps) => {
  return (
    <View 
      className={`
        flex-row items-center bg-surface-warm/50 border border-border/60 
        rounded-xl px-4 py-2.5 ${className}
      `}
    >
      <Search size={18} color="#6D6963" strokeWidth={2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9E9890"
        className="flex-1 ml-3 font-sans text-fg text-[15px] pt-0.5"
        selectionColor="#7A8F6A"
      />
      {value.length > 0 && (
        <Pressable onPress={onClear || (() => onChangeText(''))} className="p-1">
          <X size={16} color="#9E9890" />
        </Pressable>
      )}
    </View>
  );
};
