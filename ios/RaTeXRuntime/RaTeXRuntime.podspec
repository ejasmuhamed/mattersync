require 'json'

package = JSON.parse(File.read(File.join(__dir__, '../../node_modules/ratex-react-native/package.json')))

Pod::Spec.new do |s|
  s.name = 'RaTeXRuntime'
  s.version = package['version']
  s.summary = 'Dynamic boundary for the RaTeX Rust runtime'
  s.homepage = 'https://github.com/erweixin/RaTeX'
  s.license = package['license']
  s.author = 'Mattersync contributors'
  s.source = { :git => 'https://github.com/erweixin/RaTeX.git', :tag => s.version.to_s }
  s.platform = :ios, '18.0'
  s.source_files = 'RaTeXRuntime.m', 'ratex.h'
  s.public_header_files = 'ratex.h'
  s.vendored_frameworks = 'RaTeX.xcframework'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    # Export the Rust C ABI from this framework rather than linking it into the app.
    'OTHER_LDFLAGS' => '$(inherited) -Wl,-all_load'
  }
end
