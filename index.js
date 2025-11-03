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
            
            // Chercher d'abord si un salon existant avec un numéro plus bas est vide (OPTIMISÉ)
            let existingEmptyChannel = null;
            
            // Chercher dans tous les salons vocaux de la guilde (déjà en cache, très rapide)
            const voiceChannels = guild.channels.cache.filter(ch => 
                ch.type === ChannelType.GuildVoice && 
                ch.name.startsWith('💻-SESS° Chatting ')
            );
            
            // Extraire les numéros et trouver le salon vide avec le numéro le plus bas
            // On cherche seulement jusqu'au compteur actuel pour être rapide
            for (const channel of voiceChannels.values()) {
                const match = channel.name.match(/💻-SESS° Chatting (\d+)/);
                if (match) {
                    const channelNumber = parseInt(match[1]);
                    
                    // Ne chercher que les salons avec un numéro inférieur au compteur actuel
                    if (channelNumber < channelCounter) {
                        // Vérifier si le salon est vide (pas de membres non-bots) - vérification rapide
                        if (channel.members.size === 0 || channel.members.every(m => m.user.bot)) {
                            // C'est un salon vide avec un numéro plus bas
                            if (!existingEmptyChannel || channelNumber < parseInt(existingEmptyChannel.name.match(/💻-SESS° Chatting (\d+)/)?.[1] || '999')) {
                                existingEmptyChannel = channel;
                            }
                        }
                    }
                }
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
                // Générer le nom du salon avec le compteur
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
                    // Incrémenter le compteur pour le prochain salon
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
                            // Incrémenter le compteur pour le prochain salon
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
            
            // OPTIMISATION : Déplacer l'utilisateur IMMÉDIATEMENT après la création du salon
            // Ne pas attendre les permissions pour une réaction instantanée
            activePrivateChannels.set(member.id, privateChannel.id);
            
            // Déplacer l'utilisateur en parallèle de la configuration des permissions
            const moveUserPromise = member.voice.setChannel(privateChannel.id).catch(error => {
                console.error(`❌ Erreur lors du déplacement immédiat: ${error.message}`);
            });
            
            // Étape 2 : Modifier les permissions APRÈS la création pour rendre le salon privé
            // Cela se fait en parallèle du déplacement pour ne pas ralentir
            const permissionsPromise = (async () => {
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
                    // Appliquer les permissions en PARALLÈLE pour plus de rapidité
                    // IMPORTANT : Appliquer d'abord tous les deny, puis les allow
                    const denyOverwrites = permissionOverwrites.filter(o => o.deny && !o.allow);
                    const allowOverwrites = permissionOverwrites.filter(o => o.allow);
                    
                    // Fonction helper pour convertir les permissions
                    const convertPerms = (overwrite) => {
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
                        
                        return { allowBits, denyBits };
                    };
                    
                    // Appliquer TOUS les deny en parallèle (plus rapide)
                    const denyPromises = denyOverwrites.map(async (overwrite) => {
                        try {
                            const { denyBits } = convertPerms(overwrite);
                            const existingOverwrite = privateChannel.permissionOverwrites.cache.get(overwrite.id);
                            
                            if (existingOverwrite) {
                                await existingOverwrite.edit({ allow: 0n, deny: denyBits });
                            } else {
                                await privateChannel.permissionOverwrites.create(overwrite.id, { allow: 0n, deny: denyBits });
                            }
                        } catch (error) {
                            // Erreur silencieuse
                        }
                    });
                    
                    // Attendre que les deny soient appliqués (mais en parallèle donc rapide)
                    await Promise.all(denyPromises);
                    
                    // Appliquer TOUS les allow en parallèle
                    const allowPromises = allowOverwrites.map(async (overwrite) => {
                        try {
                            const { allowBits, denyBits } = convertPerms(overwrite);
                            const existingOverwrite = privateChannel.permissionOverwrites.cache.get(overwrite.id);
                            
                            if (existingOverwrite) {
                                await existingOverwrite.edit({ allow: allowBits, deny: denyBits });
                            } else {
                                await privateChannel.permissionOverwrites.create(overwrite.id, { allow: allowBits, deny: denyBits });
                            }
                        } catch (error) {
                            // Erreur silencieuse
                        }
                    });
                    
                    // Ne pas attendre les allow - on peut déplacer l'utilisateur pendant ce temps
                    allowPromises.forEach(p => p.catch(() => {})); // En arrière-plan
                    
                    // IMPORTANT : Réappliquer les deny APRÈS tous les allow pour éviter qu'ils soient écrasés
                    // Mais on le fait en parallèle pour ne pas bloquer
                    const denyReapplyPromise = Promise.all(denyOverwrites.map(async (overwrite) => {
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
                            }
                        } catch (finalDenyError) {
                            // Erreur silencieuse - on continue
                        }
                    }));
                    
                    // Ne pas attendre cette réapplication - elle se fera en arrière-plan
                    denyReapplyPromise.catch(() => {}); // Ignorer les erreurs
                    
                    // Vérifications optionnelles en arrière-plan (non-bloquant pour l'expérience utilisateur)
                    // Ces vérifications peuvent se faire après le déplacement de l'utilisateur
                    setImmediate(async () => {
                        try {
                            const botRole = guild.members.me.roles.highest;
                            const blockedRole = await guild.roles.fetch('1344774671987642428').catch(() => null);
                            
                            if (blockedRole && botRole && botRole.position <= blockedRole.position) {
                                console.error(`❌ PROBLÈME CRITIQUE : Le rôle du bot est en position ${botRole.position}, le rôle bloqué est en position ${blockedRole.position}`);
                            }
                            
                            // Vérification rapide des deny (sans délai important)
                            await new Promise(resolve => setTimeout(resolve, 300)); // Délai minimal
                            const blockedRoleOverwrite = privateChannel.permissionOverwrites.cache.get('1344774671987642428');
                            
                            if (blockedRoleOverwrite) {
                                const denyPerms = blockedRoleOverwrite.deny;
                                if (!denyPerms || !denyPerms.has(PermissionFlagsBits.ViewChannel)) {
                                    // Réappliquer les deny si nécessaire (en arrière-plan)
                                    try {
                                        const fullDeny = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect | PermissionFlagsBits.Speak;
                                        await blockedRoleOverwrite.edit({
                                            allow: 0n,
                                            deny: fullDeny
                                        });
                                        console.log(`🔄 Deny réappliqués en arrière-plan pour le rôle bloqué`);
                                    } catch (bgError) {
                                        // Ignorer silencieusement les erreurs en arrière-plan
                                    }
                                }
                            }
                        } catch (bgCheckError) {
                            // Ignorer les erreurs de vérification en arrière-plan
                        }
                    });
                    
                    console.log(`✅ Permissions configurées - Le salon est maintenant PRIVÉ`);
                }
            } catch (permError) {
                console.error(`❌ Erreur lors de la configuration des permissions : ${permError.message}`);
                console.error(`💡 Assurez-vous que le bot a la permission "Gérer les rôles"`);
                console.warn(`⚠️  Le salon a été créé mais les permissions privées n'ont pas été appliquées !`);
            }
            })();
            
            // Attendre que l'utilisateur soit déplacé (priorité absolue)
            await moveUserPromise;
            console.log(`✅ Utilisateur ${member.displayName} déplacé instantanément dans ${privateChannel.name}`);
            
            // Les permissions continuent en arrière-plan - ne pas bloquer
            permissionsPromise.catch(() => {});

            // Vérification de sécurité : ne jamais stocker le salon déclencheur
            if (privateChannel.id === triggerChannelId) {
                console.error(`❌ ERREUR : Tentative de stocker le salon déclencheur - Bloquée pour sécurité`);
                console.error(`💡 Le salon déclencheur ne devrait jamais être supprimé !`);
                return;
            }

            console.log(`✅ Salon créé pour ${member.displayName} (${member.id}) : ${privateChannel.name}`);
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

