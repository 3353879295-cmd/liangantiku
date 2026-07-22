export default {
  extends: ['stylelint-config-standard'],
  rules: {
    'declaration-property-value-no-unknown': null,
    'import-notation': 'string',
    'selector-class-pattern': null,
    'selector-type-no-unknown': [true, { ignoreTypes: ['page'] }],
    'unit-no-unknown': [true, { ignoreUnits: ['rpx'] }],
  },
};
