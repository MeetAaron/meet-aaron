#!/usr/bin/env ruby
# ios-app/patch-ios.rb
#
# Retouche le projet Xcode genere par `npx cap add ios`.
#
# Pourquoi un script plutot qu'un projet Xcode commite : @capacitor/cli est
# bloque par le proxy de l'environnement de developpement, le projet ne peut
# donc pas etre genere ici. Il l'est sur le macOS de Codemagic, a chaque
# compilation — ce qui a d'ailleurs un avantage : on ne traine pas un projet
# Xcode de 200 fichiers dans le depot, et une mise a jour de Capacitor ne
# demande aucune fusion manuelle.
#
# Trois choses que `cap add ios` ne fait pas et dont on a besoin :
#   1. le fichier d'habilitations avec aps-environment (notifications push) ;
#   2. le reglage CODE_SIGN_ENTITLEMENTS qui le rattache a la cible ;
#   3. le nom affiche sous l'icone et la version, alignes sur Android.

require 'xcodeproj'

PROJECT   = 'ios/App/App.xcodeproj'
TARGET    = 'App'
VERSION   = ENV['APP_VERSION']       || '1.0.0'
BUILD_NUM = ENV['BUILD_NUMBER']      || '1'

abort "Projet introuvable : #{PROJECT} — `npx cap add ios` a-t-il bien tourne ?" unless Dir.exist?(PROJECT)

# 1. Habilitations
entitlements_path = 'ios/App/App/App.entitlements'
File.write(entitlements_path, <<~XML)
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
    <key>aps-environment</key>
    <string>production</string>
  </dict>
  </plist>
XML
puts "habilitations ecrites : #{entitlements_path}"

project = Xcodeproj::Project.open(PROJECT)
target  = project.targets.find { |t| t.name == TARGET } or abort "Cible #{TARGET} introuvable"

# Le fichier doit exister dans le groupe du projet, sinon Xcode l'ignore.
group = project.main_group.find_subpath('App', true)
unless group.files.any? { |f| f.path == 'App.entitlements' }
  group.new_file('App.entitlements')
  puts 'App.entitlements ajoute au groupe App'
end

# 2 et 3. Reglages de compilation
target.build_configurations.each do |config|
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements'
  config.build_settings['MARKETING_VERSION']      = VERSION
  config.build_settings['CURRENT_PROJECT_VERSION'] = BUILD_NUM
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'app.meetaaron.twa'
  # iPhone ET iPad ('1,2'), choix d'Alex du 01/10/2026 (j'avais propose
  # iPhone seul pour la v1, il a tranche l'inverse).
  #
  # Ce que ca implique, et ce n'est pas qu'une case a cocher : App Store
  # Connect exigera un jeu complet de captures iPad 13 pouces
  # (2064 x 2752) EN PLUS des captures iPhone, et la revue Apple regardera
  # reellement la mise en page sur tablette. L'interface web etant
  # responsive, le risque est faible, mais il n'est pas nul : une colonne
  # de 1200 px de large qui s'etire sur un iPad en paysage peut valoir un
  # refus au titre de la regle 4.0 (Design).
  config.build_settings['TARGETED_DEVICE_FAMILY'] = '1,2'
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '14.0'
end
project.save
puts "projet Xcode mis a jour (version #{VERSION}, build #{BUILD_NUM})"

# 4. Info.plist : nom affiche sous l'icone, et les descriptions d'usage.
# Une description manquante fait planter l'application au moment ou iOS
# affiche la demande d'autorisation — et c'est un refus certain en revue.
require 'plist'
plist_path = 'ios/App/App/Info.plist'
plist = Plist.parse_xml(plist_path)
plist['CFBundleDisplayName'] = 'Meet Aaron'
plist['CFBundleName']        = 'Meet Aaron'
plist['ITSAppUsesNonExemptEncryption'] = false
plist['NSCameraUsageDescription']      = 'Pour joindre une photo a un devis ou a un document client.'
plist['NSPhotoLibraryUsageDescription'] = 'Pour joindre un document depuis votre photothèque.'
plist['NSPhotoLibraryAddUsageDescription'] = 'Pour enregistrer un document genere par Aaron.'
File.write(plist_path, plist.to_plist)
puts 'Info.plist mis a jour'
