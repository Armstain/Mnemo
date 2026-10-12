// Stand-in for react-native in unit tests: the logic under test only asks
// which platform it runs on.
export const Platform = { OS: 'android', select: <T,>(o: { android?: T; default?: T }) => o.android ?? o.default };
