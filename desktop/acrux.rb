# The Homebrew cask: brew install --cask ashesbloom/tap/acrux. Each release (.github/workflows/release.yml) copies it
# into ashesbloom/homebrew-tap with that release's version and the .dmg's sha256.
cask "acrux" do
  version "1.0.0"
  sha256 "set by release.yml"

  url "https://github.com/ashesbloom/music-webpage/releases/download/v#{version}/ACRUX-#{version}-mac.dmg",
      verified: "github.com/ashesbloom/music-webpage/"
  name "ACRUX"
  desc "Local-first music player with a spinning record"
  homepage "https://github.com/ashesbloom/music-webpage"

  app "ACRUX.app"

  # ACRUX is signed ad hoc, not notarized by Apple: this clears the download flag and signs it for this Mac (the
  # README's command), so it opens without a warning. No auto_updates: the app updates its own files, but a new
  # Electron needs brew upgrade.
  postflight_steps do
    run "/usr/bin/xattr", args: ["-drs", "com.apple.quarantine", "{{appdir}}/ACRUX.app"]
    run "/usr/bin/codesign", args: ["--force", "--deep", "--sign", "-", "{{appdir}}/ACRUX.app"]
  end

  zap trash: [
    "~/Library/Application Support/ACRUX",
    "~/Library/Preferences/com.ashesbloom.acrux.plist",
    "~/Library/Saved Application State/com.ashesbloom.acrux.savedState",
  ]
end
