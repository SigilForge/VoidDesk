exports.default = async function (context) {
  // Rename the unpacked directory inside ZIP to just "VoidDesk"
  if (context.packager.platform.nodeName === 'win32') {
    context.packager.appInfo.productName = 'VoidDesk';
  }
};