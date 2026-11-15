// components/StyledJsxRegistry.jsx
//
// STYLES PRESENTS DES LE PREMIER AFFICHAGE (15/11/2026).
//
// Retour d'Alex en ouvrant l'app iPhone : « une page blanche bizarre, bien
// buggee, puis seulement le menu de connexion — on a l'impression de se
// faire hacker ».
//
// Cause mesuree en production : toutes les pages mettent leur mise en forme
// dans des blocs <style jsx>. Sans ce registre, Next.js n'envoie AUCUN de ces
// styles dans le HTML : ils ne sont poses qu'une fois le JavaScript
// telecharge et execute. Entre-temps le navigateur affiche le HTML brut
// (texte noir, liens bleus, fond creme). En Wi-Fi ca dure un clin d'oeil ;
// en 4G, plusieurs secondes.
//
// Ce composant collecte les styles pendant le rendu serveur et les glisse
// dans le HTML envoye : la page arrive deja mise en forme. C'est le montage
// documente par Next.js pour styled-jsx avec l'App Router. Cote navigateur,
// styled-jsx reconnait les balises deja presentes (id="__jsx-…") et ne les
// pose pas une seconde fois.

'use client';

import React, { useState } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { StyleRegistry, createStyleRegistry } from 'styled-jsx';

export default function StyledJsxRegistry({ children }) {
  const [registry] = useState(() => createStyleRegistry());

  useServerInsertedHTML(() => {
    const styles = registry.styles();
    registry.flush();
    return <>{styles}</>;
  });

  return <StyleRegistry registry={registry}>{children}</StyleRegistry>;
}
