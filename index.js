const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ]
});

// Stockage des salons créés dynamiquement : userId -> channelId
const activePrivateChannels = new Map();

// Compteur pour le nom des salons (s'incrémente à chaque création)
let channelCounter = 1;

client.once('ready', async () => {
    console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
    console.log(`🔄 Bot prêt à créer des salons vocaux privés !`);
    
    // Vérifier les permissions du bot sur le serveur
    const guildId = process.env.GUILD_ID;
    if (guildId) {
        try {
            const guild = await client.guilds.fetch(guildId);
            const botMember = await guild.members.fetch(client.user.id);
            const permissions = botMember.permissions;
            
            console.log(`\n📋 Vérification des permissions du bot...`);
            const requiredPerms = [
                { name: 'Gérer les salons', flag: PermissionFlagsBits.ManageChannels },
                { name: 'Gérer les rôles', flag: PermissionFlagsBits.ManageRoles },
                { name: 'Déplacer les membres', flag: PermissionFlagsBits.MoveMembers },
                { name: 'Se connecter (voix)', flag: PermissionFlagsBits.Connect },
                { name: 'Parler (voix)', flag: PermissionFlagsBits.Speak }
            ];
            
            let allPerms = true;
            for (const perm of requiredPerms) {
                const hasPerm = permissions.has(perm.flag);
                console.log(`   ${hasPerm ? '✅' : '❌'} ${perm.name}`);
                if (!hasPerm) allPerms = false;
            }
            
            if (!allPerms) {
                console.log(`\n⚠️  Le bot n'a pas toutes les permissions nécessaires !`);
                console.log(`💡 Allez dans Paramètres du serveur > Rôles > Sélectionnez le rôle du bot`);
                console.log(`   Activez toutes les permissions ci-dessus.\n`);
            } else {
                console.log(`✅ Le bot a toutes les permissions nécessaires !\n`);
            }
        } catch (error) {
            console.error(`⚠️  Impossible de vérifier les permissions :`, error.message);
        }
    }
});

// Quand un membre rejoint un salon vocal
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member;
    if (!member) return;

    const triggerChannelId = process.env.TRIGGER_CHANNEL_ID;
    
    // Si la personne rejoint le salon déclencheur
    if (newState.channelId === triggerChannelId) {
        try {
            // Vérifier si l'utilisateur a déjà un salon actif
            if (activePrivateChannels.has(member.id)) {
                const existingChannelId = activePrivateChannels.get(member.id);
                const existingChannel = await client.channels.fetch(existingChannelId).catch(() => null);
                
                if (existingChannel) {
                    // Si le salon existe encore, on déplace l'utilisateur dedans
                    await member.voice.setChannel(existingChannelId);
                    return;
                } else {
                    // Si le salon n'existe plus, on le retire de la map
                    activePrivateChannels.delete(member.id);
                }
            }

            // Récupérer la catégorie du salon déclencheur (si elle existe)
            const triggerChannel = await client.channels.fetch(triggerChannelId);
            const categoryId = triggerChannel.parentId;

            // Créer un nouveau salon vocal privé
            const guild = member.guild;
            
            // Vérifier que le bot a les permissions nécessaires au niveau serveur
            const botMember = await guild.members.fetch(client.user.id);
            const botPermissions = botMember.permissions;
            
            if (!botPermissions.has(PermissionFlagsBits.ManageChannels)) {
                console.error(`❌ Le bot n'a pas la permission "Gérer les salons" sur le serveur !`);
                console.error(`💡 Allez dans les paramètres du serveur > Rôles > Sélectionnez le rôle du bot > Activez "Gérer les salons"`);
                return;
            }

            // Vérifier les permissions dans la catégorie si elle existe
            if (categoryId) {
                try {
                    const category = await guild.channels.fetch(categoryId);
                    if (category && category.type === ChannelType.GuildCategory) {
                        const botRole = guild.members.me.roles.highest;
                        const categoryPerms = category.permissionsFor(botRole || guild.members.me);
                        
                        if (categoryPerms && !categoryPerms.has(PermissionFlagsBits.ManageChannels)) {
                            console.warn(`⚠️  Le bot n'a pas la permission "Gérer les salons" dans la catégorie "${category.name}"`);
                            console.warn(`💡 Le salon sera créé sans catégorie (à la racine du serveur)`);
                            // On continuera sans catégorie
                        }
                    }
                } catch (error) {
                    console.warn(`⚠️  Impossible de vérifier les permissions de la catégorie : ${error.message}`);
                }
            }

            // Préparer les permissions du salon
            // Personne ne peut voir le salon SAUF la personne connectée et le rôle spécifique
            // IMPORTANT : L'ordre compte - les deny doivent être définis en premier pour bloquer les permissions supérieures
            const permissionOverwrites = [
                {
                    id: guild.roles.everyone.id, // @everyone
                    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect], // Invisible pour tout le monde
                },
                {
                    id: '1344774671987642428', // Rôle qui ne doit PAS voir les salons - EN PREMIER pour bloquer toutes ses permissions
                    deny: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.Connect,
                        PermissionFlagsBits.Speak,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ], // Blocage complet - même si le rôle a des permissions au niveau serveur
                },
                {
                    id: member.id, // Le propriétaire du salon
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak], // Peut voir et rejoindre
                },
                {
                    id: '1353435878659330130', // Rôle spécifique qui peut voir le salon
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect], // Peut voir et se connecter
                }
            ];

            // Essayer de créer le salon en deux étapes : d'abord créer, puis modifier les permissions
            // Cela évite les problèmes de permissions complexes lors de la création
            let privateChannel;
            
            console.log(`🔧 Tentative de création du salon pour ${member.displayName}...`);
            
            // Chercher d'abord si un salon existant vide est disponible
            // On cherche le salon vide avec le numéro le PLUS BAS possible (en commençant par 1)
            let existingEmptyChannel = null;
            let lowestEmptyNumber = Infinity;
            
            // Chercher dans tous les salons vocaux de la guilde
            // IMPORTANT : Fetch les salons pour avoir les membres à jour
            await guild.channels.fetch(); // Rafraîchir le cache
            const voiceChannels = guild.channels.cache.filter(ch => 
                ch.type === ChannelType.GuildVoice && 
                ch.name.startsWith('💻-SESS° Chatting ')
            );
            
            console.log(`🔍 Recherche de salons vides... (${voiceChannels.size} salons trouvés avec le pattern)`);
            
            // Extraire les numéros et trouver TOUS les salons vides, puis choisir le plus bas
            for (const channel of voiceChannels.values()) {
                const match = channel.name.match(/💻-SESS° Chatting (\d+)/);
                if (match) {
                    const channelNumber = parseInt(match[1]);
                    
                    // Rafraîchir le salon pour avoir les membres à jour
                    try {
                        await channel.fetch(true); // Force refresh
                    } catch (fetchError) {
                        // Si le salon n'existe plus, on continue
                        continue;
                    }
                    
                    // Vérifier si le salon est vide (pas de membres non-bots)
                    const membersInChannel = channel.members.filter(m => !m.user.bot);
                    
                    console.log(`   Salon ${channelNumber}: ${membersInChannel.size} membre(s) non-bot`);
                    
                    if (membersInChannel.size === 0) {
                        // C'est un salon vide, garder celui avec le numéro le plus bas
                        console.log(`   ✅ Salon ${channelNumber} est VIDE - candidat pour réutilisation`);
                        if (channelNumber < lowestEmptyNumber) {
                            lowestEmptyNumber = channelNumber;
                            existingEmptyChannel = channel;
                        }
                    }
                }
            }
            
            if (existingEmptyChannel) {
                console.log(`✅ Salon vide trouvé avec le numéro le plus bas : ${existingEmptyChannel.name}`);
            } else {
                console.log(`ℹ️  Aucun salon vide trouvé, recherche du premier numéro manquant...`);
                
                // Collecter tous les numéros existants
                const existingNumbers = new Set();
                for (const channel of voiceChannels.values()) {
                    const match = channel.name.match(/💻-SESS° Chatting (\d+)/);
                    if (match) {
                        const channelNumber = parseInt(match[1]);
                        existingNumbers.add(channelNumber);
                    }
                }
                
                // Trouver le premier numéro manquant en commençant par 1
                let firstMissingNumber = 1;
                while (existingNumbers.has(firstMissingNumber)) {
                    firstMissingNumber++;
                }
                
                // Utiliser le premier numéro manquant
                channelCounter = firstMissingNumber;
                console.log(`📊 Numéros existants : [${Array.from(existingNumbers).sort((a, b) => a - b).join(', ')}]`);
                console.log(`📊 Premier numéro manquant : ${firstMissingNumber}, création du salon ${firstMissingNumber}`);
            }
            
            // Si on a trouvé un salon vide avec un numéro plus bas, le réutiliser
            if (existingEmptyChannel) {
                console.log(`♻️  Réutilisation du salon existant vide : ${existingEmptyChannel.name}`);
                privateChannel = existingEmptyChannel;
                
                // Vérifier si ce salon est déjà dans la map et le retirer (il devrait être vide)
                for (const [userId, channelId] of activePrivateChannels.entries()) {
                    if (channelId === existingEmptyChannel.id) {
                        activePrivateChannels.delete(userId);
                        console.log(`   🗑️  Salon retiré de la map (était associé à un utilisateur qui a quitté)`);
                    }
                }
                
                // Réappliquer les permissions pour être sûr qu'elles sont correctes
                // (elles seront réappliquées plus loin dans le code)
            } else {
                // Aucun salon vide trouvé - créer un nouveau salon
                // Le compteur est déjà mis à jour avec le numéro suivant du plus élevé existant
                const channelName = `💻-SESS° Chatting ${channelCounter}`;
                
                // Étape 1 : Créer le salon SANS permissions personnalisées (plus simple)
                try {
                    privateChannel = await guild.channels.create({
                        name: channelName,
                        type: ChannelType.GuildVoice,
                        parent: categoryId || undefined, // Mettre dans la catégorie si elle existe
                        userLimit: 1, // Limité à 1 personne
                        // Pas de permissionOverwrites pour le moment
                    });
                    console.log(`✅ Salon créé : ${privateChannel.name} (ID: ${privateChannel.id})`);
                    // Incrémenter le compteur pour le prochain salon créé
                    channelCounter++;
                } catch (categoryError) {
                    // Si ça échoue à cause de la catégorie, essayer sans catégorie
                    if (categoryError.code === 50013 && categoryId) {
                        console.warn(`⚠️  Impossible de créer le salon dans la catégorie. Essai sans catégorie...`);
                        try {
                            privateChannel = await guild.channels.create({
                                name: channelName,
                                type: ChannelType.GuildVoice,
                                userLimit: 1
                            });
                            console.log(`✅ Salon créé sans catégorie : ${privateChannel.name}`);
                            // Incrémenter le compteur pour le prochain salon créé
                            channelCounter++;
                        } catch (rootError) {
                            console.error(`❌ Erreur lors de la création (sans catégorie aussi):`, rootError.code, rootError.message);
                            throw rootError;
                        }
                    } else {
                        console.error(`❌ Erreur lors de la création (avec catégorie):`, categoryError.code, categoryError.message);
                        throw categoryError;
                    }
                }
            }
            
            // Déplacer l'utilisateur IMMÉDIATEMENT après la création du salon
            // (sans attendre les permissions pour une réaction instantanée)
            activePrivateChannels.set(member.id, privateChannel.id);
            await member.voice.setChannel(privateChannel.id);
            console.log(`✅ Utilisateur ${member.displayName} déplacé immédiatement dans ${privateChannel.name}`);
            
            // Étape 2 : Modifier les permissions APRÈS la création pour rendre le salon privé
            // (en parallèle, après avoir déplacé l'utilisateur)
            try {
                console.log(`🔧 Configuration des permissions du salon...`);
                
                // Vérifier que le bot a la permission "Gérer les rôles"
                const botMemberCheck = await guild.members.fetch(client.user.id);
                if (!botMemberCheck.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    console.error(`❌ Le bot n'a pas la permission "Gérer les rôles" !`);
                    console.error(`💡 Allez dans Paramètres du serveur > Rôles > Sélectionnez le rôle du bot`);
                    console.error(`   Activez la permission "Gérer les rôles" (nécessaire pour rendre les salons privés)`);
                    console.warn(`⚠️  Le salon a été créé mais il n'est PAS privé !`);
                } else {
                    // Appliquer les permissions une par une
                    // IMPORTANT : Appliquer d'abord tous les deny (pour bloquer les permissions de catégorie)
                    // Puis les allow (pour donner les permissions spécifiques)
                    let successCount = 0;
                    
                    // Séparer les deny et allow pour appliquer dans le bon ordre
                    const denyOverwrites = permissionOverwrites.filter(o => o.deny && !o.allow);
                    const allowOverwrites = permissionOverwrites.filter(o => o.allow);
                    
                    // D'abord appliquer tous les deny (pour bloquer les permissions de catégorie)
                    for (const overwrite of denyOverwrites) {
                        try {
                            let denyBits = 0n;
                            if (Array.isArray(overwrite.deny)) {
                                denyBits = overwrite.deny.reduce((a, b) => a | b, 0n);
                            } else {
                                denyBits = overwrite.deny;
                            }
                            
                            const existingOverwrite = privateChannel.permissionOverwrites.cache.get(overwrite.id);
                            
                            // Construire l'objet sans inclure null - utiliser 0n pour allow si nécessaire
                            const permObject = {
                                allow: 0n,  // Pas null, mais 0n pour dire "pas de permissions allow"
                                deny: denyBits
                            };
                            
                            if (existingOverwrite) {
                                await existingOverwrite.edit(permObject);
                            } else {
                                await privateChannel.permissionOverwrites.create(overwrite.id, permObject);
                            }
                            
                            console.log(`🔒 Permission DENY appliquée pour ${overwrite.id}`);
                            successCount++;
                        } catch (permError) {
                            console.warn(`⚠️  Impossible d'appliquer la permission DENY (ID: ${overwrite.id}):`, permError.message);
                        }
                    }
                    
                    // Ensuite appliquer les allow
                    for (const overwrite of allowOverwrites) {
                        try {
                            let allowBits = 0n;
                            let denyBits = 0n;
                            
                            if (overwrite.allow) {
                                if (Array.isArray(overwrite.allow)) {
                                    allowBits = overwrite.allow.reduce((a, b) => a | b, 0n);
                                } else {
                                    allowBits = overwrite.allow;
                                }
                            }
                            
                            if (overwrite.deny) {
                                if (Array.isArray(overwrite.deny)) {
                                    denyBits = overwrite.deny.reduce((a, b) => a | b, 0n);
                                } else {
                                    denyBits = overwrite.deny;
                                }
                            }
                            
                            const existingOverwrite = privateChannel.permissionOverwrites.cache.get(overwrite.id);
                            
                            // Construire l'objet - utiliser 0n au lieu de null
                            const permObject = {
                                allow: allowBits,
                                deny: denyBits  // 0n si pas de deny
                            };
                            
                            if (existingOverwrite) {
                                await existingOverwrite.edit(permObject);
                            } else {
                                await privateChannel.permissionOverwrites.create(overwrite.id, permObject);
                            }
                            
                            console.log(`✅ Permission ALLOW appliquée pour ${overwrite.id}`);
                            successCount++;
                        } catch (permError) {
                            console.warn(`⚠️  Impossible d'appliquer la permission ALLOW (ID: ${overwrite.id}):`, permError.message);
                        }
                    }
                    
                    // IMPORTANT : Réappliquer les deny APRÈS tous les allow pour éviter qu'ils soient écrasés
                    // et pour s'assurer qu'ils overrident les permissions de catégorie
                    console.log(`🔄 Réapplication finale des deny pour bloquer les permissions de catégorie...`);
                    for (const overwrite of denyOverwrites) {
                        try {
                            let denyBits = 0n;
                            if (Array.isArray(overwrite.deny)) {
                                denyBits = overwrite.deny.reduce((a, b) => a | b, 0n);
                            } else {
                                denyBits = overwrite.deny;
                            }
                            
                            const existingOverwrite = privateChannel.permissionOverwrites.cache.get(overwrite.id);
                            if (existingOverwrite) {
                                await existingOverwrite.edit({
                                    allow: 0n,
                                    deny: denyBits
                                });
                                console.log(`🔒 Permission DENY réappliquée finalement pour ${overwrite.id}`);
                            }
                        } catch (finalDenyError) {
                            console.warn(`⚠️  Impossible de réappliquer le deny final (ID: ${overwrite.id}):`, finalDenyError.message);
                        }
                    }
                    
                    // Vérifier la hiérarchie des rôles - CRUCIAL pour que les deny fonctionnent
                    const botRole = guild.members.me.roles.highest;
                    const blockedRole = await guild.roles.fetch('1344774671987642428').catch(() => null);
                    
                    if (blockedRole && botRole) {
                        if (botRole.position <= blockedRole.position) {
                            console.error(`❌ PROBLÈME CRITIQUE : Le rôle du bot est en position ${botRole.position}, le rôle bloqué est en position ${blockedRole.position}`);
                            console.error(`💡 Le rôle du bot DOIT être AU-DESSUS du rôle bloqué dans la hiérarchie !`);
                        } else {
                            console.log(`✅ Hiérarchie OK : Bot (${botRole.position}) > Rôle bloqué (${blockedRole.position})`);
                        }
                    }
                    
                    // Attendre et vérifier que les deny sont bien appliqués
                    // Les deny au niveau du salon doivent overrider les permissions de catégorie
                    console.log(`🔄 Vérification finale des deny appliqués...`);
                    
                    // Attendre un peu plus longtemps pour que Discord synchronise
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 secondes
                    
                    // Rafraîchir complètement le salon depuis l'API
                    const refreshedChannel = await guild.channels.fetch(privateChannel.id, { force: true });
                    const blockedRoleOverwrite = refreshedChannel.permissionOverwrites.cache.get('1344774671987642428');
                    
                    if (blockedRoleOverwrite) {
                        const denyPerms = blockedRoleOverwrite.deny;
                        const allowPerms = blockedRoleOverwrite.allow;
                        
                        console.log(`   📊 État des permissions pour le rôle bloqué:`);
                        console.log(`      Allow: ${allowPerms ? allowPerms.bitfield.toString() : '0'} (${allowPerms ? allowPerms.bitfield : '0n'})`);
                        console.log(`      Deny: ${denyPerms ? denyPerms.bitfield.toString() : '0'} (${denyPerms ? denyPerms.bitfield : '0n'})`);
                        
                        // Analyser les permissions allow pour voir ce qui est hérité
                        if (allowPerms && allowPerms.bitfield > 0n) {
                            console.log(`   ⚠️  Le rôle a des permissions allow (probablement de la catégorie)`);
                            if (allowPerms.has(PermissionFlagsBits.ViewChannel)) {
                                console.log(`   ⚠️  Le rôle a "Voir le salon" dans allow (hérité de la catégorie)`);
                            }
                            if (allowPerms.has(PermissionFlagsBits.ManageChannels)) {
                                console.log(`   ❌ PROBLÈME: Le rôle a "Gérer les salons" - cela empêche les deny de fonctionner !`);
                            }
                        }
                        
                        // Vérifier si ViewChannel est dans deny
                        const hasViewChannelDeny = denyPerms && denyPerms.has(PermissionFlagsBits.ViewChannel);
                        
                        if (hasViewChannelDeny) {
                            console.log(`✅ Le rôle bloqué (1344774671987642428) a bien les permissions deny - Le salon devrait être invisible pour ce rôle`);
                            console.log(`   Les deny au niveau du salon overrident les permissions de catégorie ✅`);
                        } else {
                            console.warn(`⚠️  Les deny ne persistent pas malgré les tentatives`);
                            console.warn(`   Le bitfield Allow=${allowPerms?.bitfield.toString() || '0'} indique des permissions héritées de la catégorie`);
                            console.warn(`   💡 SOLUTION: Vous devez retirer "Voir le salon" pour ce rôle au niveau de la CATÉGORIE`);
                            console.warn(`   Puis ajouter "Voir le salon" uniquement pour les salons que le rôle DOIT voir`);
                            console.warn(`   OU créer les salons privés dans une catégorie différente`);
                            
                            // Essayer une approche plus agressive : supprimer et recréer l'overwrite
                            try {
                                console.log(`   🔄 Tentative de suppression et recréation de l'overwrite...`);
                                await blockedRoleOverwrite.delete();
                                await new Promise(resolve => setTimeout(resolve, 500));
                                
                                const fullDeny = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect | PermissionFlagsBits.Speak;
                                await privateChannel.permissionOverwrites.create('1344774671987642428', {
                                    allow: 0n,
                                    deny: fullDeny
                                });
                                console.log(`   ✅ Overwrite supprimé et recréé avec deny uniquement`);
                            } catch (finalError) {
                                console.error(`   ❌ Erreur lors de la suppression/recréation: ${finalError.message}`);
                            }
                        }
                    } else {
                        console.error(`❌ L'overwrite pour le rôle bloqué n'existe toujours pas après toutes les tentatives`);
                    }
                    
                    if (successCount === permissionOverwrites.length) {
                        console.log(`✅ Toutes les permissions ont été configurées - Le salon est maintenant PRIVÉ`);
                    } else {
                        console.warn(`⚠️  Seulement ${successCount}/${permissionOverwrites.length} permissions ont été appliquées`);
                        console.warn(`💡 Le salon pourrait ne pas être complètement privé.`);
                    }
                }
            } catch (permError) {
                console.error(`❌ Erreur lors de la configuration des permissions : ${permError.message}`);
                console.error(`💡 Assurez-vous que le bot a la permission "Gérer les rôles"`);
                console.warn(`⚠️  Le salon a été créé mais les permissions privées n'ont pas été appliquées !`);
            }

            // Vérification de sécurité : ne jamais stocker le salon déclencheur
            // triggerChannelId est déjà défini au début de la fonction
            if (privateChannel.id === triggerChannelId) {
                console.error(`❌ ERREUR : Tentative de stocker le salon déclencheur - Bloquée pour sécurité`);
                console.error(`💡 Le salon déclencheur ne devrait jamais être supprimé !`);
                return;
            }

            console.log(`✅ Salon créé et utilisateur déplacé pour ${member.displayName} (${member.id}) : ${privateChannel.name}`);
        } catch (error) {
            if (error.code === 50013) {
                console.error(`\n❌ Erreur de permissions lors de la création du salon pour ${member.displayName}`);
                console.error(`\n🔍 Diagnostic :`);
                console.error(`   Le bot a les permissions au niveau serveur, mais l'erreur persiste.`);
                console.error(`\n💡 Solutions possibles :`);
                console.error(`   1. Si le salon déclencheur est dans une CATÉGORIE :`);
                console.error(`      → Clic droit sur la catégorie > Modifier la catégorie`);
                console.error(`      → Onglet "Permissions"`);
                console.error(`      → Ajoutez le rôle du bot avec la permission "Gérer les salons"`);
                console.error(`\n   2. Vérifiez que le bot a un rôle au-dessus des autres rôles :`);
                console.error(`      → Paramètres du serveur > Rôles`);
                console.error(`      → Glissez le rôle du bot VERS LE HAUT (plus haut = plus de permissions)`);
                console.error(`\n   3. Alternative : Créez une catégorie dédiée au bot :`);
                console.error(`      → Créez une nouvelle catégorie`);
                console.error(`      → Donnez au bot toutes les permissions dans cette catégorie`);
                console.error(`      → Placez le salon déclencheur dans cette catégorie\n`);
            } else {
                console.error(`❌ Erreur lors de la création du salon pour ${member.displayName}:`, error.message);
            }
        }
    }

    // Si la personne quitte son salon privé ou se déconnecte
    if (activePrivateChannels.has(member.id)) {
        const privateChannelId = activePrivateChannels.get(member.id);
        const triggerChannelId = process.env.TRIGGER_CHANNEL_ID;
        
        // IMPORTANT : Ne jamais supprimer le salon déclencheur !
        if (privateChannelId === triggerChannelId) {
            console.warn(`⚠️  Tentative de suppression du salon déclencheur détectée - Ignorée pour sécurité`);
            activePrivateChannels.delete(member.id);
            return;
        }
        
        // Si la personne quitte le salon privé ou se déconnecte complètement
        if (newState.channelId !== privateChannelId && (oldState.channelId === privateChannelId || !newState.channelId)) {
            try {
                const privateChannel = await client.channels.fetch(privateChannelId).catch(() => null);
                
                if (privateChannel) {
                    // Double vérification : s'assurer que ce n'est pas le salon déclencheur
                    if (privateChannel.id === triggerChannelId) {
                        console.warn(`⚠️  Tentative de suppression du salon déclencheur - Bloquée`);
                        activePrivateChannels.delete(member.id);
                        return;
                    }
                    
                    // Vérifier si le salon est vide (ou seulement avec des bots)
                    const membersInChannel = privateChannel.members.filter(m => !m.user.bot);
                    
                    if (membersInChannel.size === 0) {
                        // Supprimer le salon privé uniquement
                        await privateChannel.delete();
                        activePrivateChannels.delete(member.id);
                        console.log(`🗑️ Salon privé supprimé pour ${member.displayName} (${member.id})`);
                    } else {
                        // Le salon n'est pas vide, on le garde
                        console.log(`ℹ️  Salon privé de ${member.displayName} non supprimé - encore ${membersInChannel.size} membre(s) présent(s)`);
                    }
                } else {
                    // Le salon n'existe plus (déjà supprimé manuellement peut-être)
                    activePrivateChannels.delete(member.id);
                    console.log(`ℹ️  Salon privé déjà supprimé pour ${member.displayName} (${member.id})`);
                }
            } catch (error) {
                // Si l'erreur est "Unknown Channel", c'est que le salon n'existe plus (normal)
                if (error.code === 10003) {
                    console.log(`ℹ️  Salon privé déjà supprimé pour ${member.displayName} (${member.id})`);
                    activePrivateChannels.delete(member.id);
                } else {
                    console.error(`❌ Erreur lors de la suppression du salon pour ${member.displayName}:`, error.message);
                    activePrivateChannels.delete(member.id);
                }
            }
        }
    }
});

// Nettoyage si le bot redémarre : vérifier que les salons stockés existent encore
client.once('clientReady', async () => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) return;
    
    try {
        const guild = await client.guilds.fetch(guildId);
        if (!guild) return;

        // Vérifier tous les salons stockés
        for (const [userId, channelId] of activePrivateChannels.entries()) {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) {
                activePrivateChannels.delete(userId);
            }
        }
    } catch (error) {
        // Ignorer les erreurs lors du nettoyage au démarrage
    }
});

// Gestion des erreurs
client.on('error', error => {
    console.error('❌ Erreur Discord.js:', error);
});

process.on('unhandledRejection', error => {
    console.error('❌ Erreur non gérée:', error);
});

// Connexion du bot
client.login(process.env.BOT_TOKEN).catch(error => {
    console.error('❌ Erreur de connexion:', error);
    console.error('💡 Vérifiez que votre BOT_TOKEN dans le fichier .env est correct !');
});

