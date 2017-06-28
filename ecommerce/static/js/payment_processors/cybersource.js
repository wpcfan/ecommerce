/* global Cybersource */
/**
 * CyberSource payment processor specific actions.
 */
require([
    'jquery',
    'pages/basket_page',
    'js-cookie'
], function($, BasketPage, Cookies) {
    'use strict';

    var CyberSourceClient = {
        init: function() {
            var $paymentForm = $('#paymentForm'),
                $pciFields = $('.pci-field', $paymentForm),
                cardMap = {
                    visa: '001',
                    mastercard: '002',
                    amex: '003',
                    discover: '004'
                };

            this.signingUrl = Cybersource.signingUrl;   // jshint ignore:line

            // The payment form should post to CyberSource
            $paymentForm.attr('action', Cybersource.postUrl);   // jshint ignore:line

            // Add name attributes to the PCI fields
            $pciFields.each(function() {
                var $this = $(this);
                $this.attr('name', $this.data('name'));
            });

            $paymentForm.submit($.proxy(this.onSubmit, this));

            // Add CyberSource-specific fields
            $paymentForm.append($('<input type="hidden" name="card_expiry_date" class="pci-field">'));
            $paymentForm.append($('<input type="hidden" name="card_type" class="pci-field">'));

            // Add an event listener to populate the CyberSource card type field
            $paymentForm.on('cardType:detected', function(event, data) {
                $('input[name=card_type]', $paymentForm).val(cardMap[data.type]);
            });

            this.applePayConfig = Cybersource.applePay;
            this.initializeApplePay();
        },

        /**
         * Payment form submit handler.
         *
         * Before posting to CyberSource, this handler retrieves signed data fields from the server. PCI fields
         * (e.g. credit card number, expiration) should NEVER be posted to the server, only to CyberSource.
         *
         * @param event
         */
        onSubmit: function(event) {
            var $form = $(event.target),
                $signedFields = $('input,select', $form).not('.pci-field'),
                expMonth = $('#card-expiry-month', $form).val(),
                expYear = $('#card-expiry-year', $form).val();

            // Restore name attributes so the data can be posted to CyberSource
            $('#card-number', $form).attr('name', 'card_number');
            $('#card-cvn', $form).attr('name', 'card_cvn');

            // Post synchronously since we need the returned data.
            $.ajax({
                type: 'POST',
                url: this.signingUrl,
                data: $signedFields.serialize(),
                async: false,
                success: function(data) {
                    var formData = data.form_fields,
                        key;

                    // Format the date for CyberSource (MM-YYYY)
                    $('input[name=card_expiry_date]', $form).val(expMonth + '-' + expYear);

                    // Disable the fields on the form so they are not posted since their names are not what is
                    // expected by CyberSource. Instead post add the parameters from the server to the form,
                    // and post them.
                    $signedFields.attr('disabled', 'disabled');

                    // eslint-disable-next-line no-restricted-syntax
                    for (key in formData) {
                        if (Object.prototype.hasOwnProperty.call(formData, key)) {
                            $form.append(
                                '<input type="hidden" name="' + key + '" value="' + formData[key] + '" />'
                            );
                        }
                    }
                },

                error: function(jqXHR, textStatus) {
                    var $field,
                        cardHolderFields,
                        error,
                        k;

                    // Don't allow the form to submit.
                    event.preventDefault();
                    event.stopPropagation();

                    cardHolderFields = [
                        'first_name', 'last_name', 'address_line1', 'address_line2', 'state', 'city', 'country',
                        'postal_code'
                    ];

                    if (textStatus === 'error') {
                        error = JSON.parse(jqXHR.responseText);

                        if (error.field_errors) {
                            // eslint-disable-next-line no-restricted-syntax
                            for (k in error.field_errors) {
                                if (cardHolderFields.indexOf(k) !== -1) {
                                    $field = $('input[name=' + k + ']');
                                    // TODO Use custom events to remove this dependency.
                                    BasketPage.appendCardHolderValidationErrorMsg($field, error.field_errors[k]);
                                    $field.focus();
                                }
                            }
                        } else {
                            // Unhandled errors should redirect to the general payment error page.
                            window.location.href = window.paymentErrorPath;
                        }
                    }
                }
            });
        },

        initializeApplePay: function() {
            var self = this;

            if (window.ApplePaySession) {
                ApplePaySession.canMakePaymentsWithActiveCard(self.applePayConfig.merchantIdentifier).then(
                    function(canMakePayments) {
                        var applePayBtn = document.getElementById('applePayBtn'),
                            applePaySetupBtn = document.getElementById('applePaySetupBtn');

                        if (canMakePayments) {
                            console.log('Learner is eligible for Apple Pay');
                            applePayBtn.style.display = 'inline-flex';
                            applePayBtn.addEventListener('click', self.onApplePayButtonClicked.bind(self));
                        } else {
                            console.log('Apple Pay not setup.');

                            if (ApplePaySession.openPaymentSetup) {
                                applePaySetupBtn.style.display = 'inline-flex';
                                applePaySetupBtn.addEventListener(
                                    'click', self.onApplePaySetupButtonClicked.bind(self));
                            } else {
                                console.log(
                                    'ApplePaySession.openPaymentSetup is not defined. Learner cannot setup Apple Pay.');
                            }
                        }
                    }
                );
            }
        },

        onApplePayButtonClicked: function(event) {
            var self = this,
                session = new ApplePaySession(2, {
                    countryCode: self.applePayConfig.countryCode,
                    currencyCode: self.applePayConfig.basketCurrency,
                    supportedNetworks: ['amex', 'discover', 'visa', 'masterCard'],
                    merchantCapabilities: ['supports3DS', 'supportsCredit', 'supportsDebit'],
                    total: {
                        label: self.applePayConfig.merchantName,
                        type: 'final',
                        amount: self.applePayConfig.basketTotal
                    },
                    requiredBillingContactFields: ['postalAddress']
                });

            session.onvalidatemerchant = function(evt) {
                console.log('Validating merchant...');

                $.post({
                    url: self.applePayConfig.startSessionUrl,
                    headers: {
                        'X-CSRFToken': Cookies.get('ecommerce_csrftoken')
                    },
                    data: JSON.stringify({url: evt.validationURL}),
                    contentType: 'application/json',
                    success: function(data) {
                        console.log('Merchant validation succeeded.');
                        console.log(data);
                        session.completeMerchantValidation(data);
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        // TODO Display an error message to the learner
                        console.log('Merchant validation failed!');
                        console.log(textStatus);
                        console.log(errorThrown);
                        session.abort();
                    }
                });
            };

            session.onpaymentauthorized = function(evt) {
                console.log('Submitting Apple Pay payment to CyberSource...');

                $.post({
                    url: self.applePayConfig.authorizeUrl,
                    headers: {
                        'X-CSRFToken': Cookies.get('ecommerce_csrftoken')
                    },
                    data: JSON.stringify(evt.payment),
                    contentType: 'application/json',
                    success: function(data) {
                        console.log('Successfully submitted Apple Pay payment to CyberSource.');
                        console.log(data);
                        session.completePayment(ApplePaySession.STATUS_SUCCESS);
                        window.location.href = self.applePayConfig.receiptUrl + '?order_number=' + data.number;
                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        // TODO Display an error message to the learner
                        console.log('Failed to submit Apple Pay payment to CyberSource!');
                        console.log(textStatus);
                        console.log(errorThrown);
                        session.completePayment(ApplePaySession.STATUS_FAILURE);
                    }
                });
            };

            session.begin();

            event.preventDefault();
            event.stopPropagation();
        },

        onApplePaySetupButtonClicked: function(event) {
            var self = this;
            event.preventDefault();
            event.stopPropagation();

            ApplePaySession.openPaymentSetup(self.applePayConfig.merchantIdentifier)
                .then(function(success) {
                    if (success) {
                        // Open payment setup successful
                        // TODO Hide setup button
                        // TODO Display pay button

                    } else {
                        // Open payment setup failed
                        // TODO Inform user of setup failure
                    }
                })
                .catch(function(e) {
                    // Open payment setup error handling
                    // TODO ???
                    console.log(e);
                });
        }
    };

    $(document).ready(function() {
        CyberSourceClient.init();
    });
});
