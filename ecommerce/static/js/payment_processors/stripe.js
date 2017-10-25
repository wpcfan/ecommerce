/**
 * Stripe payment processor specific actions.
 */
require([
    'jquery',
    'underscore.string'
], function($, _s) {
    'use strict';

    function displayErrorMessage(message) {
        $('#messages').html(
            _s.sprintf(
                '<div class="alert alert-error"><i class="icon fa fa-exclamation-triangle"></i>%s</div>',
                message
            )
        );
    }

    function postTokenToServer(token, paymentRequest) {
        var postUrl = window.StripeConfig.postUrl,
            $paymentForm = $('#paymentForm'),
            formData = new FormData();

        formData.append('stripe_token', token);
        formData.append('csrfmiddlewaretoken', $('[name=csrfmiddlewaretoken]', $paymentForm).val());
        formData.append('basket', $('[name=basket]', $paymentForm).val());

        fetch(postUrl, {
            credentials: 'include',
            method: 'POST',
            body: formData
        }).then(function(response) {
            if (response.ok) {
                if (paymentRequest) {
                    // Report to the browser that the payment was successful, prompting
                    // it to close the browser payment interface.
                    paymentRequest.complete('success');
                }
                response.json().then(function(data) {
                    window.location.href = data.url;
                });

            } else {
                if (paymentRequest) {
                    // Report to the browser that the payment failed, prompting it to re-show the payment
                    // interface, or show an error message and close the payment interface.
                    paymentRequest.complete('fail');
                }

                displayErrorMessage(gettext('An error occurred while processing your payment. Please try again.'));
            }
        });
    }

    function initializePaymentRequest(stripe) {
        var paymentRequest = stripe.paymentRequest({
                country: window.StripeConfig.country,
                currency: window.StripeConfig.paymentRequest.currency,
                total: {
                    label: window.StripeConfig.paymentRequest.label,
                    amount: window.StripeConfig.paymentRequest.total
                }
            }),
            elements = stripe.elements(),
            paymentRequestButton = elements.create('paymentRequestButton', {
                paymentRequest: paymentRequest,
                style: {
                    paymentRequestButton: {
                        height: '50px'
                    }
                }
            });

        // Check the availability of the Payment Request API first.
        paymentRequest.canMakePayment().then(function(result) {
            if (result) {
                paymentRequestButton.mount('#payment-request-button');
            } else {
                document.getElementById('payment-request-button').style.display = 'none';
            }
        });

        paymentRequest.on('token', function(ev) {
            postTokenToServer(ev.token.id, ev);
        });
    }

    function onCreateCardToken(status, response) {
        var $paymentForm = $('#paymentForm');

        if (response.error) {
            console.log(response.error.message);    // eslint-disable-line no-console
            var msg = gettext('An error occurred while attempting to process your payment. You have not been ' +
                'charged. Please check your payment details, and try again.') + '<br><br>Debug Info: ' +
                response.error.message;
            displayErrorMessage(msg);
            $paymentForm.find('#payment-button').prop('disabled', false); // Re-enable submission
        } else {
            postTokenToServer(response.id);
        }
    }

    function onPaymentFormSubmit(e) {
        var data = {},
            fieldMappings = {
                'card-number': 'number',
                'card-expiry-month': 'exp_month',
                'card-expiry-year': 'exp_year',
                'card-cvn': 'cvc',
                id_postal_code: 'address_zip',
                id_address_line1: 'address_line1',
                id_address_line2: 'address_line2',
                id_city: 'address_city',
                id_state: 'address_state',
                id_country: 'address_country'
            },
            $paymentForm = $('#paymentForm');

        // Extract the form data so that it can be incorporated into our token request
        Object.keys(fieldMappings).forEach(function(id) {
            data[fieldMappings[id]] = $('#' + id, $paymentForm).val();
        });

        data.name = $('#id_first_name').val() + ' ' + $('#id_last_name').val();

        // Disable the submit button to prevent repeated clicks
        $paymentForm.find('#payment-button').prop('disabled', true);

        // Request a token from Stripe
        Stripe.card.createToken(data, onCreateCardToken);

        e.preventDefault();
    }

    $(document).ready(function() {
        var publishableKey = window.StripeConfig.publishableKey,
            postUrl = window.StripeConfig.postUrl,
            $paymentForm = $('#paymentForm'),
            stripe = Stripe(publishableKey);

        // NOTE: We use Stripe v2 for credit card payments since v3 requires using Elements, which would force us
        // to make a custom payment form just for Stripe. Using v2 allows us to continue using the same payment form
        // regardless of the backend processor.
        Stripe.setPublishableKey(publishableKey);

        $paymentForm.attr('action', postUrl);
        $paymentForm.submit(onPaymentFormSubmit);
        initializePaymentRequest(stripe);
    });
});
