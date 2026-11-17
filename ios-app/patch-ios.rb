#!/usr/bin/env ruby
# encoding: utf-8
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
    <!-- Liens universels (07/11/2026) : https://meetaaron.app/... s'ouvre
         dans l'app ; la moitié « site » est /.well-known/apple-app-site-association
         (app/api/ios/aasa/route.ts). La capacité « Associated Domains » doit
         être cochée sur l'identifiant d'app dans le portail développeur. -->
    <key>com.apple.developer.associated-domains</key>
    <array>
      <string>applinks:meetaaron.app</string>
    </array>
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
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = 'app.meetaaron.mobile'
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
  # Capacitor 8 (07/11/2026) exige iOS 15 au minimum.
  config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
end

# 3 bis. Traductions embarquees dans l'app (17/11/2026, Alex : « fais-le
# maintenant »). L'App Store deduit la ligne « Langues » de la fiche des
# dossiers <langue>.lproj presents dans l'app, PAS de CFBundleLocalizations
# (pose plus bas) : la 1.0.1 affichait donc toujours « English » seul.
# Chaque dossier contient un InfoPlist.strings : nom sous l'icone et textes
# des demandes d'autorisation (appareil photo, photos), traduits — iOS les
# affiche desormais dans la langue du telephone.
# Echec non bloquant : sans ce bloc l'app fonctionne, elle est juste
# declaree en anglais seul.
require 'fileutils'
LOCALIZED_STRINGS = {
  'en' => { 'cam' => 'To attach a photo to a quote or a customer document.', 'lib' => 'To attach a document from your photo library.', 'add' => 'To save a document created by Aaron.' },
  'fr' => { 'cam' => 'Pour joindre une photo à un devis ou à un document client.', 'lib' => 'Pour joindre un document depuis votre photothèque.', 'add' => 'Pour enregistrer un document créé par Aaron.' },
  'de' => { 'cam' => 'Um einem Angebot oder Kundendokument ein Foto beizufügen.', 'lib' => 'Um ein Dokument aus Ihrer Fotomediathek beizufügen.', 'add' => 'Um ein von Aaron erstelltes Dokument zu speichern.' },
  'it' => { 'cam' => 'Per allegare una foto a un preventivo o a un documento cliente.', 'lib' => 'Per allegare un documento dalla tua libreria foto.', 'add' => 'Per salvare un documento creato da Aaron.' },
  'es' => { 'cam' => 'Para adjuntar una foto a un presupuesto o a un documento de cliente.', 'lib' => 'Para adjuntar un documento desde tu fototeca.', 'add' => 'Para guardar un documento creado por Aaron.' },
  'pt' => { 'cam' => 'Para anexar uma foto a um orçamento ou a um documento de cliente.', 'lib' => 'Para anexar um documento a partir da sua fototeca.', 'add' => 'Para guardar um documento criado pelo Aaron.' },
  'nl' => { 'cam' => 'Om een foto toe te voegen aan een offerte of klantdocument.', 'lib' => 'Om een document uit je fotobibliotheek toe te voegen.', 'add' => 'Om een door Aaron gemaakt document op te slaan.' },
}.freeze
begin
  app_group = project.main_group.find_subpath('App', true)
  variant = app_group.children.find { |c| c.isa == 'PBXVariantGroup' && c.name == 'InfoPlist.strings' } ||
            app_group.new_variant_group('InfoPlist.strings')
  LOCALIZED_STRINGS.each do |lang, s|
    dir = File.join('ios', 'App', 'App', "#{lang}.lproj")
    FileUtils.mkdir_p(dir)
    body = [
      %("CFBundleDisplayName" = "Meet Aaron";),
      %("CFBundleName" = "Meet Aaron";),
      %("NSCameraUsageDescription" = "#{s['cam']}";),
      %("NSPhotoLibraryUsageDescription" = "#{s['lib']}";),
      %("NSPhotoLibraryAddUsageDescription" = "#{s['add']}";),
    ].join("\n") + "\n"
    File.write(File.join(dir, 'InfoPlist.strings'), body, mode: 'w:UTF-8')
    rel = "#{lang}.lproj/InfoPlist.strings"
    unless variant.files.any? { |f| f.path == rel }
      ref = variant.new_reference(rel)
      ref.name = lang
    end
  end
  regions = project.root_object.known_regions || []
  project.root_object.known_regions = (regions | %w[en Base] | LOCALIZED_STRINGS.keys)
  unless target.resources_build_phase.files_references.include?(variant)
    target.resources_build_phase.add_file_reference(variant, true)
  end
  puts "traductions embarquees : #{LOCALIZED_STRINGS.keys.join(', ')}"
rescue StandardError => e
  puts "AVERTISSEMENT traductions non embarquees : #{e.class} #{e.message}"
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
# Langues de l'app (15/11/2026). Sans cette liste, iOS considere que l'app
# n'existe qu'en anglais : la fiche App Store affichait « Languages : English »
# et, surtout, la page chargee dans l'app se voyait annoncer l'anglais comme
# langue du telephone (navigator.language) — un iPhone regle en francais
# ouvrait donc l'app en anglais. Avec la liste, iOS choisit parmi ces sept
# langues celle du telephone, et le site suit (lib/i18n.js, detectBrowserLocale).
plist['CFBundleDevelopmentRegion'] = 'en'
plist['CFBundleLocalizations'] = %w[en fr de it es pt nl]
File.write(plist_path, plist.to_plist)
puts 'Info.plist mis a jour'
